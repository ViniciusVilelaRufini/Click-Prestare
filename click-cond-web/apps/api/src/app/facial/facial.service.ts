import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  FacialDeviceClientService,
  FacialDeviceConfig,
} from './facial-device-client.service';
import { EnrollSessionService } from './enroll-session.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertSameTenant } from '../auth/tenant.util';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AccessStateService } from './access-state.service';
import { AgentBridgeService } from './agent-bridge.service';
import {
  bloqueadoPorRegrasAcesso,
  CategoriaPessoa,
  confiancaInsuficiente,
  RegraAcessoLike,
} from './access-rules.util';
import { decryptSecret, encryptSecret } from './device-secret.util';

export interface CreateDeviceDto {
  id_condominio: number;
  nome: string;
  tipo?: string;
  /** auto | entrada | saida — como interpretar a direção dos acessos. */
  sentido?: string;
  /** Confiança mínima (%) do reconhecimento facial; 0 = desligado. */
  confianca_minima?: number;
  fabricante: string;
  modelo?: string;
  ip: string;
  porta?: number;
  api_user?: string;
  api_password?: string;
}

export interface UpdateDeviceDto extends Partial<CreateDeviceDto> {}

export interface WebhookEventDto {
  device_id?: string;
  event?: string;
  person_id?: string;
  external_id?: string;
  timestamp?: string;
  confidence?: number;
  direction?: string;
  card_uid?: string;
  qrcode?: string;
}

// O enrollment liga AUTOMATICAMENTE quando há terminal facial cadastrado — a
// própria existência de devices (checada em cada sync) controla o fluxo, então
// não precisa de flag manual para "começar a funcionar". FACIAL_INTEGRATION_ENABLED
// vira um kill-switch explícito: só desliga tudo quando setado para "false".
const FACIAL_DISABLED = process.env.FACIAL_INTEGRATION_ENABLED === 'false';

// URL pública (GitHub Release) do executável do Agente Local. Fica como padrão
// para os botões/instalador funcionarem sem depender de env; pode ser
// sobrescrita por AGENT_DOWNLOAD_URL (ex.: ao publicar uma nova versão).
const AGENT_DOWNLOAD_URL =
  process.env.AGENT_DOWNLOAD_URL ||
  'https://github.com/Viniciusvile/Click-Prestare/releases/download/agent-v1.0.0/click-agent.exe';

@Injectable()
export class FacialService {
  private readonly logger = new Logger(FacialService.name);
  /** Condomínios com um bulk sync rodando agora (evita rodar em paralelo). */
  private readonly bulkSyncEmAndamento = new Set<number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: FacialDeviceClientService,
    private readonly notifications: NotificationsService,
    private readonly enrollSessions: EnrollSessionService,
    private readonly auditoria: AuditoriaService,
    private readonly accessState: AccessStateService,
    private readonly agent: AgentBridgeService,
  ) {}

  // ---------- Enrollment guiado (RFID/QR) ----------

  /**
   * Inicia sessão de captura. Operador apresenta o crachá no leitor; quando
   * uma tag não cadastrada chega no webhook desse device, o UID é desviado
   * para esta sessão em vez de processar como acesso. Portal faz polling.
   */
  async startEnrollCapture(idDevice: number) {
    const device = await this.getDevice(idDevice);
    if (device.tipo !== 'tag_reader' && device.tipo !== 'qrcode_reader') {
      throw new BadRequestException(
        'Captura guiada só funciona em leitores RFID ou QR',
      );
    }
    return this.enrollSessions.start(idDevice);
  }

  async pollEnrollCapture(sessionId: string, user?: JwtPayload) {
    const session = this.enrollSessions.get(sessionId);
    await this.assertSessionSameTenant(session.idDevice, user);
    return session;
  }

  async cancelEnrollCapture(sessionId: string, user?: JwtPayload) {
    const session = this.enrollSessions.get(sessionId);
    await this.assertSessionSameTenant(session.idDevice, user);
    this.enrollSessions.cancel(sessionId);
    return { ok: true };
  }

  private async assertSessionSameTenant(idDevice: number, user?: JwtPayload) {
    const device = await this.prisma.facial_Devices.findUnique({
      where: { id: idDevice },
      select: { id_condominio: true },
    });
    assertSameTenant(device?.id_condominio, user, `sessão de enrollment`);
  }

  /** Garante que o morador pertence ao condomínio do usuário. */
  async assertMoradorSameTenant(idMorador: number, user?: JwtPayload) {
    const m = await this.prisma.moradores.findUnique({
      where: { id: idMorador },
      select: { id_condominio: true },
    });
    if (!m) throw new NotFoundException(`Morador ${idMorador} não encontrado`);
    assertSameTenant(m.id_condominio, user, `morador #${idMorador}`);
  }

  /** Garante que o visitante pertence ao condomínio do usuário. */
  async assertVisitanteSameTenant(idVisitante: number, user?: JwtPayload) {
    const v = await this.prisma.visitantes.findUnique({
      where: { id: idVisitante },
      select: { id_condominio: true },
    });
    if (!v)
      throw new NotFoundException(`Visitante ${idVisitante} não encontrado`);
    assertSameTenant(v.id_condominio, user, `visitante #${idVisitante}`);
  }

  // ---------- Devices CRUD ----------

  async listDevices(idCondominio: number) {
    if (!this.prisma.isConnected) return [];
    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio },
      orderBy: { created_at: 'desc' },
    });
    // agent_online: indica se há um Agente Local fazendo polling deste device
    // agora. É o sinal de "está pronto para receber comandos da nuvem".
    return devices.map((d) => ({
      ...d,
      api_password: decryptSecret(d.api_password),
      agent_online: this.agent.isOnline(d.id),
      // null = desconhecido (sem reporte recente do agente); true/false = status
      // real do aparelho na LAN, atualizado pelo heartbeat do agente.
      device_online: this.agent.isDeviceOnline(d.id),
    }));
  }

  /**
   * Recebe o status dos aparelhos reportado pelo Agente Local (heartbeat
   * periódico). Confina aos dispositivos do condomínio do token.
   */
  async reportDeviceStatuses(
    idCondominio: number,
    statuses: { deviceId: number; online: boolean }[],
  ) {
    if (!Array.isArray(statuses) || statuses.length === 0) return { ok: true };
    const doCondominio = new Set(
      (
        await this.prisma.facial_Devices.findMany({
          where: { id_condominio: idCondominio },
          select: { id: true },
        })
      ).map((d) => d.id),
    );
    for (const s of statuses) {
      const id = Number(s?.deviceId);
      if (doCondominio.has(id)) {
        this.agent.reportDeviceStatus(id, !!s.online);
      }
    }
    return { ok: true };
  }

  async getDevice(id: number) {
    const d = await this.prisma.facial_Devices.findUnique({ where: { id } });
    if (!d) throw new NotFoundException(`Terminal facial ${id} não encontrado`);
    return { ...d, api_password: decryptSecret(d.api_password) };
  }

  /**
   * Dispositivos ativos de um condomínio — usado pelo agente em "modo
   * condomínio" (um único token gerencia todos os aparelhos do condomínio).
   */
  async getActiveDevices(idCondominio: number) {
    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio, ativo: 1 },
    });
    return devices.map((d) => ({
      ...d,
      api_password: decryptSecret(d.api_password),
    }));
  }

  async findDeviceByToken(token: string) {
    const d = await this.prisma.facial_Devices.findFirst({
      where: { webhook_token: token, ativo: 1 },
    });
    if (!d) throw new UnauthorizedException('Token de webhook inválido');
    return { ...d, api_password: decryptSecret(d.api_password) };
  }

  /**
   * Resolve o condomínio a partir do token do agente. Aceita o agent_token
   * (dedicado do condomínio, preferido) ou, por compatibilidade, o
   * webhook_token de um dispositivo ativo.
   */
  async resolveCondominioForAgent(token: string): Promise<number> {
    const cond = await this.prisma.condominios.findFirst({
      where: { agent_token: token },
      select: { id: true },
    });
    if (cond) return cond.id;
    const device = await this.prisma.facial_Devices.findFirst({
      where: { webhook_token: token, ativo: 1 },
      select: { id_condominio: true },
    });
    if (device) return device.id_condominio;
    throw new UnauthorizedException('Token do agente inválido');
  }

  /** Garante (e devolve) o agent_token estável do condomínio, gerando se faltar. */
  async getOrCreateAgentToken(idCondominio: number): Promise<string> {
    const cond = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: { agent_token: true },
    });
    if (!cond)
      throw new NotFoundException(`Condomínio ${idCondominio} não encontrado`);
    if (cond.agent_token) return cond.agent_token;
    const token = crypto.randomBytes(32).toString('hex');
    await this.prisma.condominios.update({
      where: { id: idCondominio },
      data: { agent_token: token },
    });
    return token;
  }

  /** Token (para o portal exibir) + URL de download do executável. */
  async getAgentInfo(idCondominio: number) {
    const token = await this.getOrCreateAgentToken(idCondominio);
    return {
      agent_token: token,
      download_url: AGENT_DOWNLOAD_URL,
    };
  }

  /**
   * Gera o arquivo de configuração do agente já personalizado para o
   * condomínio: ".env" (config pura) ou "instalar.bat" (1 clique: baixa o exe,
   * grava a config e registra o serviço no Windows).
   */
  async getAgentConfigFile(
    idCondominio: number,
    apiUrl: string,
    format: 'env' | 'bat',
  ): Promise<{ filename: string; content: string; contentType: string }> {
    const cond = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: { nome: true },
    });
    const token = await this.getOrCreateAgentToken(idCondominio);
    const apiBase = apiUrl.replace(/\/+$/, '');
    const slug =
      (cond?.nome ?? 'condominio')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 40) || 'condominio';

    if (format === 'bat') {
      const downloadUrl = AGENT_DOWNLOAD_URL;
      const baixaExe = downloadUrl
        ? [
            'if not exist "%EXE%" (',
            '  echo Baixando o agente...',
            `  powershell -Command "Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '%EXE%'"`,
            ')',
          ]
        : [
            'if not exist "%EXE%" (',
            '  echo [ERRO] click-agent.exe nao encontrado nesta pasta. Baixe-o pelo portal e rode de novo.',
            '  pause',
            '  exit /b 1',
            ')',
          ];
      const linhas = [
        '@echo off',
        'setlocal',
        'set "DIR=%~dp0"',
        'set "EXE=%DIR%click-agent.exe"',
        'set "ENVFILE=%DIR%.env"',
        '',
        'REM 1) Garante o executavel',
        ...baixaExe,
        '',
        'REM 2) Escreve a configuracao do condominio',
        '(',
        `echo API_URL=${apiBase}`,
        `echo AGENT_TOKEN=${token}`,
        ') > "%ENVFILE%"',
        '',
        'REM 3) Inicia com o Windows',
        'schtasks /Create /TN "ClickPortariaAgent" /TR "\\"%EXE%\\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F',
        'schtasks /Run /TN "ClickPortariaAgent"',
        'echo.',
        'echo Pronto! Agente instalado e rodando. Confira "Agente conectado" no portal.',
        'pause',
      ];
      return {
        filename: `instalar-agente-${slug}.bat`,
        content: linhas.join('\r\n') + '\r\n',
        contentType: 'application/octet-stream',
      };
    }

    return {
      filename: '.env',
      content: `# Agente Local — ${cond?.nome ?? ''}\r\nAPI_URL=${apiBase}\r\nAGENT_TOKEN=${token}\r\n`,
      contentType: 'text/plain; charset=utf-8',
    };
  }

  async createDevice(dto: CreateDeviceDto, operador?: JwtPayload) {
    const token = crypto.randomBytes(32).toString('hex');
    const created = await this.prisma.facial_Devices.create({
      data: {
        id_condominio: dto.id_condominio,
        nome: dto.nome,
        tipo: dto.tipo ?? 'facial',
        sentido: dto.sentido ?? 'auto',
        confianca_minima: dto.confianca_minima ?? 0,
        fabricante: dto.fabricante,
        modelo: dto.modelo ?? null,
        ip: dto.ip,
        porta: dto.porta ?? 80,
        api_user: dto.api_user ?? null,
        api_password: encryptSecret(dto.api_password ?? null),
        webhook_token: token,
      },
    });
    await this.auditoria.registrar({
      id_condominio: dto.id_condominio,
      usuario_nome: operador?.nome ?? 'sistema',
      acao: 'DEVICE_CHANGE',
      modulo: 'facial',
      entidade_id: created.id,
      descricao: `Cadastrou dispositivo "${created.nome}" (${created.tipo})`,
      detalhes: {
        tipo: created.tipo,
        fabricante: created.fabricante,
        ip: created.ip,
      },
    });
    return { ...created, api_password: decryptSecret(created.api_password) };
  }

  async updateDevice(id: number, dto: UpdateDeviceDto, operador?: JwtPayload) {
    const antes = await this.getDevice(id);
    const atual = await this.prisma.facial_Devices.update({
      where: { id },
      data: {
        ...(dto.nome !== undefined && { nome: dto.nome }),
        ...(dto.tipo !== undefined && { tipo: dto.tipo }),
        ...(dto.sentido !== undefined && { sentido: dto.sentido }),
        ...(dto.confianca_minima !== undefined && {
          confianca_minima: dto.confianca_minima,
        }),
        ...(dto.fabricante !== undefined && { fabricante: dto.fabricante }),
        ...(dto.modelo !== undefined && { modelo: dto.modelo }),
        ...(dto.ip !== undefined && { ip: dto.ip }),
        ...(dto.porta !== undefined && { porta: dto.porta }),
        ...(dto.api_user !== undefined && { api_user: dto.api_user }),
        ...(dto.api_password !== undefined && {
          api_password: encryptSecret(dto.api_password),
        }),
      },
    });
    // Detalha o que mudou (campos sensíveis: ip/porta/tipo/api_user — mudança
    // pode redirecionar a abertura para hardware diferente).
    const diff: Record<string, { de: any; para: any }> = {};
    for (const k of [
      'nome',
      'tipo',
      'sentido',
      'confianca_minima',
      'fabricante',
      'ip',
      'porta',
      'api_user',
    ] as const) {
      if (dto[k] !== undefined && (antes as any)[k] !== (atual as any)[k]) {
        diff[k] = { de: (antes as any)[k], para: (atual as any)[k] };
      }
    }
    if (dto.api_password !== undefined)
      diff['api_password'] = { de: '***', para: '***' };
    await this.auditoria.registrar({
      id_condominio: atual.id_condominio,
      usuario_nome: operador?.nome ?? 'sistema',
      acao: 'DEVICE_CHANGE',
      modulo: 'facial',
      entidade_id: id,
      descricao: `Alterou dispositivo "${atual.nome}"`,
      detalhes: { changes: diff },
    });
    return { ...atual, api_password: decryptSecret(atual.api_password) };
  }

  async removeDevice(id: number, operador?: JwtPayload) {
    const device = await this.getDevice(id);
    await this.prisma.facial_Devices.delete({ where: { id } });
    await this.auditoria.registrar({
      id_condominio: device.id_condominio,
      usuario_nome: operador?.nome ?? 'sistema',
      acao: 'DEVICE_CHANGE',
      modulo: 'facial',
      entidade_id: id,
      descricao: `Removeu dispositivo "${device.nome}"`,
      detalhes: { tipo: device.tipo, ip: device.ip },
    });
    return { ok: true };
  }

  async testDevice(id: number) {
    const device = await this.getDevice(id);
    const online = await this.client.ping(this.toConfig(device));
    return { online };
  }

  async triggerDevice(id: number, operador?: JwtPayload) {
    const device = await this.getDevice(id);
    if (device.tipo !== 'botoeira' && device.tipo !== 'catraca') {
      throw new BadRequestException(
        'Apenas dispositivos do tipo Botoeira ou Catraca podem ser acionados remotamente.',
      );
    }
    const result = await this.client.triggerRelay(this.toConfig(device));

    const nomeOperador = operador?.nome ?? 'Operador (Portal Web)';

    // Sempre registra o evento — sucesso vira 'acionado_manual', falha vira
    // 'falha_acionamento' (auditável). O operador NÃO pode pensar que abriu
    // quando não abriu.
    await this.prisma.acessos_Facial.create({
      data: {
        id_condominio: device.id_condominio,
        id_device: device.id,
        tipo_dispositivo: device.tipo,
        face_id: 'trigger_manual',
        tipo_pessoa: 'operador',
        id_pessoa: operador?.sub ?? null,
        nome_pessoa: result.ok ? nomeOperador : `${nomeOperador} (FALHA)`,
        evento: result.ok ? 'acionado_manual' : 'falha_acionamento',
        timestamp: new Date(),
      },
    });

    // Auditoria estruturada — quem, quando, qual porta, sucesso/falha.
    // Essencial para responder "quem abriu a porta às 3h da manhã?".
    await this.auditoria.registrar({
      id_condominio: device.id_condominio,
      usuario_nome: nomeOperador,
      acao: 'MANUAL_OVERRIDE',
      modulo: 'facial',
      entidade_id: device.id,
      descricao: result.ok
        ? `Acionou manualmente ${device.tipo} "${device.nome}"`
        : `FALHA ao acionar ${device.tipo} "${device.nome}"`,
      detalhes: {
        device_nome: device.nome,
        device_tipo: device.tipo,
        device_ip: device.ip,
        success: result.ok,
        statusCode: result.statusCode,
        error: result.error,
      },
    });

    if (!result.ok) {
      // 502 Bad Gateway: nosso backend OK, mas o hardware downstream falhou
      throw new BadRequestException(
        result.error
          ? `Falha ao acionar dispositivo: ${result.error}`
          : `Falha ao acionar dispositivo (HTTP ${result.statusCode ?? 'sem resposta'}).`,
      );
    }

    return { ok: true };
  }

  /**
   * Lista pessoas com foto cadastrada no condomínio do terminal.
   * Usado pelo simulador (browser) para fazer matching local de rostos.
   * Fotos armazenadas como URL no R2 são baixadas e convertidas para
   * data URL (base64) para evitar problemas de CORS no canvas do face-api.
   */
  async listPersonsForDevice(idDevice: number) {
    const device = await this.getDevice(idDevice);
    const idCondominio = device.id_condominio;

    const [moradores, visitantes] = await Promise.all([
      this.prisma.moradores.findMany({
        where: { id_condominio: idCondominio, foto_pessoa: { not: null } },
        select: { id: true, nome: true, foto_pessoa: true },
      }),
      this.prisma.visitantes.findMany({
        where: {
          id_condominio: idCondominio,
          foto_pessoa: { not: null },
          data_saida: null,
        },
        select: { id: true, nome: true, foto_pessoa: true },
      }),
    ]);

    const rawPersons = [
      ...moradores.map((m) => ({
        external_id: `morador_${m.id}`,
        tipo: 'morador',
        nome: m.nome,
        foto: m.foto_pessoa,
      })),
      ...visitantes.map((v) => ({
        external_id: `visitante_${v.id}`,
        tipo: 'visitante',
        nome: v.nome,
        foto: v.foto_pessoa,
      })),
    ];

    const persons = await Promise.all(
      rawPersons.map(async (p) => ({
        ...p,
        foto: await this.toDataUrl(p.foto),
      })),
    );

    return {
      device: {
        id: device.id,
        nome: device.nome,
        webhook_token: device.webhook_token,
      },
      persons,
      total: persons.length,
    };
  }

  /**
   * Converte foto (URL HTTP do R2, base64 puro ou data: URL) em data URL
   * com prefix correto. Necessário para o face-api processar a imagem em
   * canvas sem CORS taint.
   */
  private async toDataUrl(foto: string | null): Promise<string | null> {
    if (!foto) return null;
    if (foto.startsWith('data:')) return foto;
    if (foto.startsWith('http://') || foto.startsWith('https://')) {
      try {
        const axios = (await import('axios')).default;
        const res = await axios.get(foto, {
          responseType: 'arraybuffer',
          timeout: 15000,
        });
        const mime = res.headers['content-type'] || 'image/jpeg';
        const b64 = Buffer.from(res.data).toString('base64');
        return `data:${mime};base64,${b64}`;
      } catch (err: any) {
        this.logger.warn(
          `Falha ao baixar foto ${foto}: ${err?.message ?? err}`,
        );
        return null;
      }
    }
    // Já é base64 puro
    return `data:image/jpeg;base64,${foto}`;
  }

  // ---------- Sync ----------

  /**
   * Categorias fisicamente autorizadas num terminal pelas regras ATIVAS
   * (whitelist). null = terminal sem regras = todas as categorias liberadas.
   *
   * Só considera CATEGORIA porque é o que dá para impor via CADASTRO: quem não
   * é de uma categoria permitida não fica cadastrado no aparelho, então o
   * aparelho NEGA fisicamente (sem depender da nuvem no instante da abertura).
   * Horário e sentido seguem sendo auditados na nuvem — um leitor facial único
   * abre 24h ao reconhecer o rosto, então essas duas dimensões não dá para
   * impor por cadastro (precisariam ir para o agendamento do próprio aparelho).
   */
  private async categoriasPermitidasNoDispositivo(device: {
    id: number;
    id_condominio: number;
  }): Promise<Set<CategoriaPessoa> | null> {
    const regras = await this.prisma.regras_Acesso.findMany({
      where: {
        id_condominio: device.id_condominio,
        ativo: 1,
        dispositivos: { some: { id_dispositivo: device.id } },
      },
      select: {
        permitir_morador: true,
        permitir_visitante: true,
        permitir_prestador: true,
        permitir_funcionario: true,
      },
    });
    if (regras.length === 0) return null; // sem regras ativas = terminal liberado
    const set = new Set<CategoriaPessoa>();
    for (const r of regras) {
      if (r.permitir_morador === 1) set.add('morador');
      if (r.permitir_visitante === 1) set.add('visitante');
      if (r.permitir_prestador === 1) set.add('prestador');
      if (r.permitir_funcionario === 1) set.add('funcionario');
    }
    return set;
  }

  private categoriaAutorizada(
    permitidas: Set<CategoriaPessoa> | null,
    categoria: CategoriaPessoa,
  ): boolean {
    return permitidas === null || permitidas.has(categoria);
  }

  async syncMorador(idMorador: number, opts: { deviceIds?: number[] } = {}) {
    if (FACIAL_DISABLED)
      return { skipped: true, reason: 'integration_disabled' };
    if (!this.prisma.isConnected) return { skipped: true, reason: 'no_db' };

    const morador = await this.prisma.moradores.findUnique({
      where: { id: idMorador },
    });
    if (!morador)
      throw new NotFoundException(`Morador ${idMorador} não encontrado`);
    if (!morador.foto_pessoa) {
      // Foto removida do cadastro: se a pessoa já tinha rosto no aparelho,
      // REMOVE de todos os terminais — senão o morador continuaria abrindo com
      // um rosto órfão. E zera o face_id para não ser tratado como cadastrado.
      if (morador.face_id && morador.id_condominio) {
        await this.unsyncMorador(
          idMorador,
          morador.face_id,
          morador.id_condominio,
        );
        await this.prisma.moradores.update({
          where: { id: idMorador },
          data: { face_id: null, face_sync_status: null, face_enrolled_at: null },
        });
        return { ok: true, removed: true };
      }
      return { skipped: true, reason: 'no_photo' };
    }
    if (!morador.id_condominio) {
      return { skipped: true, reason: 'no_condominio' };
    }

    // Só sincronizamos com terminais faciais — botoeira, catraca, leitores
    // de QR/RFID não têm endpoint de cadastro de pessoa (não recebem foto).
    // opts.deviceIds limita a quais terminais mandar (seleção no portal).
    const devices = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: morador.id_condominio,
        ativo: 1,
        tipo: 'facial',
        ...(opts.deviceIds?.length ? { id: { in: opts.deviceIds } } : {}),
      },
    });
    if (devices.length === 0) {
      return { skipped: true, reason: 'no_facial_devices' };
    }

    const externalId = `morador_${morador.id}`;
    const fotoBase64 = await this.fetchPhotoAsBase64(morador.foto_pessoa);
    if (!fotoBase64) {
      await this.markMoradorSyncStatus(idMorador, 'error');
      return { ok: false, reason: 'photo_unreachable' };
    }

    const categoria: CategoriaPessoa =
      morador.tipo?.toLowerCase() === 'funcionario' ? 'funcionario' : 'morador';
    let faceId: string | null = morador.face_id ?? null;
    let allOk = true;
    let ultimoErro: string | null = null;
    const devicesSincronizados: number[] = [];
    for (const device of devices) {
      try {
        const permitidas = await this.categoriasPermitidasNoDispositivo(device);
        if (!this.categoriaAutorizada(permitidas, categoria)) {
          // A regra ATIVA do terminal não permite esta categoria: remove o rosto
          // do aparelho para que ele NEGUE fisicamente (não basta logar negado).
          await this.client.removePerson(
            this.toConfig(device),
            faceId ?? externalId,
          );
          continue;
        }
        if (faceId) {
          await this.client.updatePerson(this.toConfig(device), faceId, {
            nome: morador.nome,
            fotoBase64,
          });
        } else {
          const r = await this.client.enrollPerson(this.toConfig(device), {
            externalId,
            nome: morador.nome,
            fotoBase64,
          });
          faceId = r.faceId;
        }
        devicesSincronizados.push(device.id);
      } catch (err: any) {
        allOk = false;
        ultimoErro = err?.message ?? String(err);
        this.logger.warn(
          `Sync morador ${idMorador} device ${device.id} falhou: ${ultimoErro}`,
        );
      }
    }

    // Atualiza ultima_sincr dos devices que receberam a sync com sucesso —
    // não bloqueante: erros de update são logados mas não falham o sync.
    if (devicesSincronizados.length > 0) {
      const agora = new Date();
      this.prisma.facial_Devices
        .updateMany({
          where: { id: { in: devicesSincronizados } },
          data: { ultima_sincr: agora },
        })
        .catch((err) =>
          this.logger.warn(
            `Falha ao atualizar ultima_sincr (morador ${idMorador}): ${err?.message ?? err}`,
          ),
        );
    }

    const status = this.classificarSync(allOk, ultimoErro);
    await this.prisma.moradores.update({
      where: { id: idMorador },
      data: {
        face_id: faceId,
        face_sync_status: status,
        face_enrolled_at: allOk ? new Date() : morador.face_enrolled_at,
      },
    });

    return { ok: allOk, face_id: faceId, status, error: ultimoErro };
  }

  /**
   * Classifica o resultado de um sync por pessoa:
   *   synced  = deu certo
   *   error   = foto recusada pelo aparelho (sem rosto nítido) — não adianta
   *             re-tentar até trocar a foto
   *   pending = falha transitória (agente offline/timeout) — re-tenta sozinho
   */
  private classificarSync(
    allOk: boolean,
    ultimoErro: string | null,
  ): 'synced' | 'error' | 'pending' {
    if (allOk) return 'synced';
    const e = (ultimoErro ?? '').toLowerCase();
    if (/recus|bad request|sem rosto|\bface\b|rosto/.test(e)) return 'error';
    return 'pending';
  }

  /**
   * Formata uma data no padrão Dahua "YYYY-MM-DD HH:MM:SS", no fuso do
   * condomínio (Brasília). É a validade gravada no usuário do aparelho —
   * precisa bater com o relógio LOCAL do aparelho, que está em horário local.
   */
  private formatDahuaTime(d: Date): string {
    return d
      .toLocaleString('sv-SE', {
        timeZone: 'America/Sao_Paulo',
        hour12: false,
      })
      .replace(',', '');
  }

  async syncVisitante(idVisitante: number, opts: { deviceIds?: number[] } = {}) {
    if (FACIAL_DISABLED)
      return { skipped: true, reason: 'integration_disabled' };
    if (!this.prisma.isConnected) return { skipped: true, reason: 'no_db' };

    const visitante = await this.prisma.visitantes.findUnique({
      where: { id: idVisitante },
    });
    if (!visitante)
      throw new NotFoundException(`Visitante ${idVisitante} não encontrado`);
    if (!visitante.foto_pessoa) {
      // Foto removida: remove o rosto órfão do aparelho e zera o face_id.
      if (visitante.face_id && visitante.id_condominio) {
        await this.unsyncVisitante(
          idVisitante,
          visitante.face_id,
          visitante.id_condominio,
        );
        await this.prisma.visitantes.update({
          where: { id: idVisitante },
          data: { face_id: null, face_sync_status: null, face_enrolled_at: null },
        });
        return { ok: true, removed: true };
      }
      return { skipped: true, reason: 'no_photo' };
    }

    // O rosto do visitante só fica no aparelho enquanto ele está AUTORIZADO —
    // liberado=1 E dentro da janela de validade, OU atualmente DENTRO (entrou e
    // ainda não saiu, p/ poder sair). Sem isso, um visitante já sem liberação
    // (ou expirado) seria reconhecido e o aparelho ABRIRIA, mesmo a nuvem
    // negando. Prestador (liberado fixo=1) permanece enquanto na janela.
    const agora = Date.now();
    const inicioMs = visitante.data_hora_inicio
      ? new Date(visitante.data_hora_inicio).getTime()
      : null;
    const terminoMs = visitante.data_hora_termino
      ? new Date(visitante.data_hora_termino).getTime()
      : null;
    const GRACE = 15 * 60 * 1000;
    const dentroJanela =
      (inicioMs === null || agora >= inicioMs - GRACE) &&
      (terminoMs === null || agora <= terminoMs + GRACE);
    const dentroDoCondominio =
      !!visitante.data_entrada && !visitante.data_saida;
    const autorizado =
      (visitante.liberado === 1 && dentroJanela) || dentroDoCondominio;
    if (!autorizado) {
      if (visitante.face_id && visitante.id_condominio) {
        await this.unsyncVisitante(
          idVisitante,
          visitante.face_id,
          visitante.id_condominio,
        );
        await this.prisma.visitantes.update({
          where: { id: idVisitante },
          data: { face_id: null, face_sync_status: null, face_enrolled_at: null },
        });
        return { ok: true, removed: true, reason: 'nao_autorizado' };
      }
      return { skipped: true, reason: 'nao_autorizado' };
    }

    // Só terminais faciais recebem cadastro de pessoa (foto + face_id).
    // Botoeira/catraca/QR/RFID não armazenam biometria. opts.deviceIds limita.
    const devices = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: visitante.id_condominio,
        ativo: 1,
        tipo: 'facial',
        ...(opts.deviceIds?.length ? { id: { in: opts.deviceIds } } : {}),
      },
    });
    if (devices.length === 0) {
      return { skipped: true, reason: 'no_facial_devices' };
    }

    const externalId = `visitante_${visitante.id}`;
    const fotoBase64 = await this.fetchPhotoAsBase64(visitante.foto_pessoa);
    if (!fotoBase64) {
      await this.markVisitanteSyncStatus(idVisitante, 'error');
      return { ok: false, reason: 'photo_unreachable' };
    }

    const categoria: CategoriaPessoa =
      visitante.is_prestador === 1 ? 'prestador' : 'visitante';
    // Validade gravada NO APARELHO (ele nega sozinho após o término, sem
    // depender da nuvem). Sem janela = permanente (prestador). Ver formatDahuaTime.
    const validFrom = visitante.data_hora_inicio
      ? this.formatDahuaTime(new Date(visitante.data_hora_inicio))
      : undefined;
    const validTo = visitante.data_hora_termino
      ? this.formatDahuaTime(new Date(visitante.data_hora_termino))
      : undefined;
    let faceId: string | null = visitante.face_id ?? null;
    let allOk = true;
    let ultimoErro: string | null = null;
    const devicesSincronizados: number[] = [];
    for (const device of devices) {
      try {
        const permitidas = await this.categoriasPermitidasNoDispositivo(device);
        if (!this.categoriaAutorizada(permitidas, categoria)) {
          await this.client.removePerson(
            this.toConfig(device),
            faceId ?? externalId,
          );
          continue;
        }
        if (faceId) {
          await this.client.updatePerson(this.toConfig(device), faceId, {
            nome: visitante.nome,
            fotoBase64,
            validFrom,
            validTo,
          });
        } else {
          const r = await this.client.enrollPerson(this.toConfig(device), {
            externalId,
            nome: visitante.nome,
            fotoBase64,
            validFrom,
            validTo,
          });
          faceId = r.faceId;
        }
        devicesSincronizados.push(device.id);
      } catch (err: any) {
        allOk = false;
        ultimoErro = err?.message ?? String(err);
        this.logger.warn(
          `Sync visitante ${idVisitante} device ${device.id} falhou: ${ultimoErro}`,
        );
      }
    }

    // Mesma lógica de atualização de ultima_sincr do syncMorador.
    if (devicesSincronizados.length > 0) {
      const agora = new Date();
      this.prisma.facial_Devices
        .updateMany({
          where: { id: { in: devicesSincronizados } },
          data: { ultima_sincr: agora },
        })
        .catch((err) =>
          this.logger.warn(
            `Falha ao atualizar ultima_sincr (visitante ${idVisitante}): ${err?.message ?? err}`,
          ),
        );
    }

    const status = this.classificarSync(allOk, ultimoErro);
    await this.prisma.visitantes.update({
      where: { id: idVisitante },
      data: {
        face_id: faceId,
        face_sync_status: status,
        face_enrolled_at: allOk ? new Date() : visitante.face_enrolled_at,
      },
    });

    return { ok: allOk, face_id: faceId, status, error: ultimoErro };
  }

  async unsyncMorador(
    idMorador: number,
    faceId: string | null,
    idCondominio: number | null,
  ) {
    if (FACIAL_DISABLED || !faceId || !idCondominio) return;
    // Mesmo critério do sync: só terminais faciais têm /persons.
    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio, ativo: 1, tipo: 'facial' },
    });
    for (const device of devices) {
      try {
        await this.client.removePerson(this.toConfig(device), faceId);
      } catch (err: any) {
        this.logger.warn(
          `Remoção morador ${idMorador} device ${device.id}: ${err?.message ?? err}`,
        );
      }
    }
  }

  async unsyncVisitante(
    idVisitante: number,
    faceId: string | null,
    idCondominio: number,
  ) {
    if (FACIAL_DISABLED || !faceId) return;
    // Mesmo critério do sync: só terminais faciais têm /persons.
    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio, ativo: 1, tipo: 'facial' },
    });
    for (const device of devices) {
      try {
        await this.client.removePerson(this.toConfig(device), faceId);
      } catch (err: any) {
        this.logger.warn(
          `Remoção visitante ${idVisitante} device ${device.id}: ${err?.message ?? err}`,
        );
      }
    }
  }

  // ---------- Sincronização em massa (back-fill) ----------

  /**
   * Envia para os terminais faciais os rostos de TODAS as pessoas já
   * cadastradas (moradores + visitantes ativos com foto) do condomínio.
   *
   * É o "back-fill" que resolve o cenário real de implantação: os moradores
   * são cadastrados ANTES do facial existir (ou enquanto o agente está offline)
   * — então as fotos existentes não subiram. Esta função empurra todas elas.
   *
   * Processa em SEGUNDO PLANO e sequencialmente (não satura o agente nem
   * bloqueia a resposta HTTP). O progresso aparece em face_sync_status, que o
   * portal exibe via getSyncStatus.
   *
   * @param opts.onlyPending true = só quem ainda não está 'synced' (usado no
   *        auto-sync quando o agente conecta). false = re-sincroniza todos
   *        (botão manual "Sincronizar rostos").
   */
  async syncAllForCondominio(
    idCondominio: number,
    opts: {
      onlyPending?: boolean;
      /** Filtra QUEM sincronizar. Vazio/ausente = todas as categorias. */
      categorias?: CategoriaPessoa[];
      /** Limita a QUAIS terminais faciais mandar. Vazio/ausente = todos. */
      deviceIds?: number[];
    } = {},
  ) {
    if (FACIAL_DISABLED)
      return { skipped: true, reason: 'integration_disabled' };
    if (!this.prisma.isConnected) return { skipped: true, reason: 'no_db' };

    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio, ativo: 1, tipo: 'facial' },
      select: { id: true },
    });
    if (devices.length === 0) {
      return { skipped: true, reason: 'no_facial_devices' };
    }

    if (this.bulkSyncEmAndamento.has(idCondominio)) {
      return { alreadyRunning: true };
    }

    // Filtro "pendente": ainda não sincronizado com sucesso.
    const pendenteWhere = opts.onlyPending
      ? {
          OR: [
            { face_sync_status: { not: 'synced' } },
            { face_sync_status: null },
            { face_id: null },
          ],
        }
      : {};

    // Filtro por categoria. moradores table = morador|funcionario;
    // visitantes table = visitante|prestador. Sub-filtro com null-safety.
    const cats = opts.categorias?.length ? new Set(opts.categorias) : null;
    const queryMorador =
      !cats || cats.has('morador') || cats.has('funcionario');
    const queryVisitante =
      !cats || cats.has('visitante') || cats.has('prestador');
    const moradorTipoWhere =
      !cats || (cats.has('morador') && cats.has('funcionario'))
        ? {}
        : cats.has('funcionario')
          ? { tipo: 'funcionario' }
          : { OR: [{ tipo: { not: 'funcionario' } }, { tipo: null }] };
    // is_prestador é Int não-nulável (0/1) — NÃO filtrar por null (quebra o
    // Prisma). visitante = is_prestador != 1; prestador = is_prestador == 1.
    const visitanteTipoWhere =
      !cats || (cats.has('visitante') && cats.has('prestador'))
        ? {}
        : cats.has('prestador')
          ? { is_prestador: 1 }
          : { is_prestador: { not: 1 } };

    // Relevante para sync = tem foto (cadastrar) OU tem face_id (pode precisar
    // RECONCILIAR/remover do aparelho — ex.: foto removida deixou rosto órfão).
    // AND evita colisão de chave 'OR' com o filtro de pendentes/categoria.
    const temFotoOuFace = {
      OR: [{ foto_pessoa: { not: null } }, { face_id: { not: null } }],
    };
    const [moradores, visitantes] = await Promise.all([
      queryMorador
        ? this.prisma.moradores.findMany({
            where: {
              id_condominio: idCondominio,
              AND: [temFotoOuFace, pendenteWhere, moradorTipoWhere],
            },
            select: { id: true },
          })
        : Promise.resolve([] as { id: number }[]),
      queryVisitante
        ? this.prisma.visitantes.findMany({
            where: {
              id_condominio: idCondominio,
              data_saida: null,
              AND: [temFotoOuFace, pendenteWhere, visitanteTipoWhere],
            },
            select: { id: true },
          })
        : Promise.resolve([] as { id: number }[]),
    ]);

    const total = moradores.length + visitantes.length;
    if (total === 0) return { total: 0, started: false };

    this.bulkSyncEmAndamento.add(idCondominio);
    // Não await: roda em background. O event loop continua após o return.
    void (async () => {
      let ok = 0;
      let falhou = 0;
      try {
        const deviceIds = opts.deviceIds;
        for (const m of moradores) {
          try {
            await this.syncMorador(m.id, { deviceIds });
            ok++;
          } catch (e: any) {
            falhou++;
            this.logger.warn(`Bulk sync morador ${m.id}: ${e?.message ?? e}`);
          }
        }
        for (const v of visitantes) {
          try {
            await this.syncVisitante(v.id, { deviceIds });
            ok++;
          } catch (e: any) {
            falhou++;
            this.logger.warn(`Bulk sync visitante ${v.id}: ${e?.message ?? e}`);
          }
        }
        this.logger.log(
          `Bulk sync condomínio ${idCondominio}: ${ok} ok, ${falhou} falha(s) de ${total}`,
        );
      } finally {
        this.bulkSyncEmAndamento.delete(idCondominio);
      }
    })();

    return { total, started: true };
  }

  /**
   * Contadores do status de sincronização facial dos moradores do condomínio —
   * para o portal mostrar o progresso do back-fill (X enviados, Y pendentes).
   */
  async getSyncStatus(idCondominio: number) {
    if (!this.prisma.isConnected) {
      return {
        synced: 0,
        pending: 0,
        error: 0,
        semFoto: 0,
        comFoto: 0,
        total: 0,
        running: false,
      };
    }
    // Conta moradores E visitantes/prestadores (ativos = sem data_saida), pois
    // todos sincronizam rosto no aparelho. Antes só contava moradores.
    const vis = { id_condominio: idCondominio, data_saida: null };
    const [
      mSynced,
      mError,
      mComFoto,
      mTotal,
      vSynced,
      vError,
      vComFoto,
      vTotal,
    ] = await Promise.all([
      this.prisma.moradores.count({
        where: { id_condominio: idCondominio, face_sync_status: 'synced' },
      }),
      this.prisma.moradores.count({
        where: { id_condominio: idCondominio, face_sync_status: 'error' },
      }),
      this.prisma.moradores.count({
        where: { id_condominio: idCondominio, foto_pessoa: { not: null } },
      }),
      this.prisma.moradores.count({ where: { id_condominio: idCondominio } }),
      this.prisma.visitantes.count({
        where: { ...vis, face_sync_status: 'synced' },
      }),
      this.prisma.visitantes.count({
        where: { ...vis, face_sync_status: 'error' },
      }),
      this.prisma.visitantes.count({
        where: { ...vis, foto_pessoa: { not: null } },
      }),
      this.prisma.visitantes.count({ where: vis }),
    ]);
    const synced = mSynced + vSynced;
    const error = mError + vError;
    const comFoto = mComFoto + vComFoto;
    const total = mTotal + vTotal;
    // Pendente = tem foto mas ainda não está 'synced' nem em 'error'.
    const pending = Math.max(comFoto - synced - error, 0);
    return {
      synced,
      pending,
      error,
      semFoto: total - comFoto,
      comFoto,
      total,
      running: this.bulkSyncEmAndamento.has(idCondominio),
    };
  }

  /**
   * Lista por PESSOA o status de sincronização facial (com motivo legível), para
   * o portal mostrar QUEM está pendente/erro — não só os números. Ordena erros e
   * pendentes primeiro. Inclui quem tem foto OU face_id (pega órfãos também).
   */
  async listSyncPessoas(idCondominio: number) {
    if (!this.prisma.isConnected) return [];
    const where = {
      OR: [{ foto_pessoa: { not: null } }, { face_id: { not: null } }],
    };
    const [moradores, visitantes] = await Promise.all([
      this.prisma.moradores.findMany({
        where: { id_condominio: idCondominio, ...where },
        select: {
          id: true,
          nome: true,
          tipo: true,
          foto_pessoa: true,
          face_sync_status: true,
        },
      }),
      this.prisma.visitantes.findMany({
        where: { id_condominio: idCondominio, data_saida: null, ...where },
        select: {
          id: true,
          nome: true,
          is_prestador: true,
          foto_pessoa: true,
          face_sync_status: true,
        },
      }),
    ]);

    const lista = [
      ...moradores.map((m) => ({
        tipo: 'morador' as const,
        categoria:
          m.tipo?.toLowerCase() === 'funcionario' ? 'funcionario' : 'morador',
        id: m.id,
        nome: m.nome,
        tem_foto: !!m.foto_pessoa,
        status: this.statusPessoa(m.face_sync_status, !!m.foto_pessoa),
        motivo: this.motivoSync(m.face_sync_status, !!m.foto_pessoa),
      })),
      ...visitantes.map((v) => ({
        tipo: 'visitante' as const,
        categoria: v.is_prestador === 1 ? 'prestador' : 'visitante',
        id: v.id,
        nome: v.nome,
        tem_foto: !!v.foto_pessoa,
        status: this.statusPessoa(v.face_sync_status, !!v.foto_pessoa),
        motivo: this.motivoSync(v.face_sync_status, !!v.foto_pessoa),
      })),
    ];

    const ordem: Record<string, number> = {
      error: 0,
      pending: 1,
      no_photo: 2,
      synced: 3,
    };
    lista.sort((a, b) => (ordem[a.status] ?? 9) - (ordem[b.status] ?? 9));
    return lista;
  }

  private statusPessoa(
    faceSyncStatus: string | null,
    temFoto: boolean,
  ): 'synced' | 'error' | 'pending' | 'no_photo' {
    if (faceSyncStatus === 'synced') return 'synced';
    if (faceSyncStatus === 'error') return 'error';
    if (!temFoto) return 'no_photo';
    return 'pending';
  }

  private motivoSync(faceSyncStatus: string | null, temFoto: boolean): string {
    const s = this.statusPessoa(faceSyncStatus, temFoto);
    if (s === 'synced') return 'Enviado ao aparelho.';
    if (s === 'error')
      return 'Foto recusada pelo aparelho (rosto não detectado). Troque a foto.';
    if (s === 'no_photo') return 'Sem foto cadastrada.';
    return 'Aguardando envio (terminal ou agente).';
  }

  // ---------- Webhook ----------

  async processWebhook(token: string, payload: WebhookEventDto) {
    const device = await this.prisma.facial_Devices.findFirst({
      where: { webhook_token: token, ativo: 1 },
    });
    if (!device) throw new UnauthorizedException('Token de webhook inválido');
    return this.runWebhook(device, payload);
  }

  /**
   * Ingestão de evento de acesso vinda do Agente Local (modo condomínio).
   *
   * Aparelhos Dahua/Intelbras não fazem push HTTP para uma URL arbitrária: o
   * Agente Local assina o stream de eventos do aparelho (eventManager.cgi) e
   * repassa cada acesso por aqui. Autentica pelo token do condomínio (o mesmo
   * usado no poll) e confina o evento ao device daquele tenant. Reusa toda a
   * resolução de pessoa/regra do webhook.
   */
  async processAgentEvent(
    agentToken: string,
    deviceId: number,
    payload: WebhookEventDto,
  ) {
    if (!Number.isInteger(deviceId)) {
      throw new BadRequestException('deviceId inválido');
    }
    const idCondominio = await this.resolveCondominioForAgent(agentToken);
    const device = await this.prisma.facial_Devices.findFirst({
      where: { id: deviceId, ativo: 1 },
    });
    if (!device || device.id_condominio !== idCondominio) {
      throw new UnauthorizedException('Dispositivo inválido para este agente');
    }
    // Só terminais faciais geram eventos por este canal; rejeita o resto para
    // não virar vetor de injeção de acessos em leitores de outro tipo.
    if (device.tipo !== 'facial') {
      throw new BadRequestException('Endpoint de evento é só para terminal facial');
    }
    // Evento sem credencial reconhecida não vira acesso — descarta cedo (evita
    // poluir o histórico com "desconhecido" via chamadas forjadas/vazias).
    const credencial = payload.external_id ?? payload.person_id;
    if (!credencial) {
      throw new BadRequestException('Evento sem identificador de pessoa');
    }
    return this.runWebhook(device, payload);
  }

  private async runWebhook(
    device: NonNullable<
      Awaited<ReturnType<PrismaService['facial_Devices']['findFirst']>>
    >,
    payload: WebhookEventDto,
  ) {
    // Aceita o push nativo do Control iD (formato Monitor "object_changes")
    // além do nosso formato limpo. Converte para WebhookEventDto antes de seguir.
    const normalizado = this.normalizeControlIdPayload(payload as unknown);
    if (normalizado) payload = normalizado;

    let tipoPessoa:
      | 'morador'
      | 'visitante'
      | 'prestador'
      | 'funcionario'
      | null = null;
    let idPessoa: number | null = null;
    let nomePessoa = 'Desconhecido';
    let faceIdSalvo = '';
    const confianca = payload.confidence ?? null;
    const timestamp = payload.timestamp
      ? new Date(payload.timestamp)
      : new Date();
    let evento = this.resolveEvento(device.sentido, payload);

    const qrCodeLido =
      payload.qrcode ??
      (device.tipo === 'qrcode_reader' ? payload.external_id : undefined);
    const tagRfidLida =
      payload.card_uid ??
      (device.tipo === 'tag_reader' ? payload.external_id : undefined);
    const externalId = payload.external_id ?? payload.person_id ?? '';

    // Cooldown: descarta eventos duplicados do mesmo leitor para a mesma
    // credencial dentro da janela (default 15s). Protege contra leitor com
    // defeito disparando em loop e contra usuário batendo o crachá duas vezes.
    const credencial = qrCodeLido ?? tagRfidLida ?? externalId ?? '';
    if (
      credencial &&
      this.accessState.shouldDebounce(device.id, credencial, evento)
    ) {
      this.logger.debug(
        `Webhook ignorado por cooldown: device ${device.id}, credencial ${credencial}`,
      );
      return { ok: true, debounced: true };
    }

    if (qrCodeLido) {
      const morador = await this.prisma.moradores.findFirst({
        where: {
          qrcode_acesso: qrCodeLido,
          id_condominio: device.id_condominio,
        },
      });
      if (morador) {
        tipoPessoa =
          morador.tipo?.toLowerCase() === 'funcionario'
            ? 'funcionario'
            : 'morador';
        idPessoa = morador.id;
        nomePessoa = morador.nome;
        faceIdSalvo = qrCodeLido;
      } else {
        const visitante = await this.findVisitanteByCredencial(
          { codigo_acesso: qrCodeLido, id_condominio: device.id_condominio },
          evento,
        );
        if (visitante) {
          tipoPessoa = visitante.is_prestador === 1 ? 'prestador' : 'visitante';
          idPessoa = visitante.id;
          nomePessoa = visitante.nome;
          faceIdSalvo = qrCodeLido;
        }
      }
    } else if (tagRfidLida) {
      const morador = await this.prisma.moradores.findFirst({
        where: { tag_rfid: tagRfidLida, id_condominio: device.id_condominio },
      });
      if (morador) {
        tipoPessoa =
          morador.tipo?.toLowerCase() === 'funcionario'
            ? 'funcionario'
            : 'morador';
        idPessoa = morador.id;
        nomePessoa = morador.nome;
        faceIdSalvo = tagRfidLida;
      } else {
        const visitante = await this.findVisitanteByCredencial(
          { tag_rfid: tagRfidLida, id_condominio: device.id_condominio },
          evento,
        );
        if (visitante) {
          tipoPessoa = visitante.is_prestador === 1 ? 'prestador' : 'visitante';
          idPessoa = visitante.id;
          nomePessoa = visitante.nome;
          faceIdSalvo = tagRfidLida;
        }
      }
    } else if (externalId) {
      const parsed = this.parseExternalId(externalId);
      if (parsed.tipo === 'morador') {
        const m = await this.prisma.moradores.findUnique({
          where: { id: parsed.id },
        });
        if (m) {
          tipoPessoa =
            m.tipo?.toLowerCase() === 'funcionario' ? 'funcionario' : 'morador';
          idPessoa = m.id;
          nomePessoa = m.nome;
          faceIdSalvo = m.face_id ?? externalId;
        }
      } else if (parsed.tipo === 'visitante') {
        const v = await this.prisma.visitantes.findUnique({
          where: { id: parsed.id },
        });
        if (v) {
          tipoPessoa = v.is_prestador === 1 ? 'prestador' : 'visitante';
          idPessoa = v.id;
          nomePessoa = v.nome;
          faceIdSalvo = v.face_id ?? externalId;
        }
      } else {
        // Identificador fora do padrão morador_X/visitante_X (ex.: user_id
        // numérico do Control iD) — resolve pela coluna face_id, que o
        // enrollment grava com o id interno do aparelho.
        const m = await this.prisma.moradores.findFirst({
          where: { face_id: externalId, id_condominio: device.id_condominio },
        });
        if (m) {
          tipoPessoa =
            m.tipo?.toLowerCase() === 'funcionario' ? 'funcionario' : 'morador';
          idPessoa = m.id;
          nomePessoa = m.nome;
          faceIdSalvo = m.face_id ?? externalId;
        } else {
          const v = await this.prisma.visitantes.findFirst({
            where: { face_id: externalId, id_condominio: device.id_condominio },
          });
          if (v) {
            tipoPessoa = v.is_prestador === 1 ? 'prestador' : 'visitante';
            idPessoa = v.id;
            nomePessoa = v.nome;
            faceIdSalvo = v.face_id ?? externalId;
          }
        }
      }
    }

    if (!idPessoa || !tipoPessoa) {
      // Antes de negar, checa se há uma sessão de enrollment aguardando
      // capturar um UID/QR justamente para este leitor. Se sim, desvia o
      // valor para a sessão e responde "captured" sem registrar como acesso.
      const isLeitor =
        device.tipo === 'tag_reader' || device.tipo === 'qrcode_reader';
      const valorLido = qrCodeLido ?? tagRfidLida ?? externalId;
      if (isLeitor && valorLido) {
        const captured = this.enrollSessions.consumeForDevice(
          device.id,
          valorLido,
        );
        if (captured) {
          this.logger.log(
            `Enrollment capture: sessão ${captured.id} recebeu ${valorLido} no device ${device.id}`,
          );
          return {
            ok: true,
            captured: true,
            sessionId: captured.id,
            value: valorLido,
          };
        }
      }

      await this.prisma.acessos_Facial.create({
        data: {
          id_condominio: device.id_condominio,
          id_device: device.id,
          tipo_dispositivo: device.tipo,
          face_id: qrCodeLido ?? tagRfidLida ?? externalId ?? 'desconhecido',
          tipo_pessoa: 'desconhecido',
          id_pessoa: null,
          nome_pessoa: 'Não identificado ou expirado',
          evento: 'negado',
          confianca,
          timestamp,
        },
      });
      throw new BadRequestException(
        'Acesso negado: Credencial não encontrada ou inválida',
      );
    }

    // Terminal único bidirecional (sentido "auto") que NÃO informa a direção —
    // caso dos faciais Intelbras/Dahua, que só dizem "reconheci o UserID". Sem
    // tratar, todo reconhecimento viraria "entrada" e o anti-passback bloquearia
    // do 2º acesso em diante. Resolvemos alternando pelo último acesso da pessoa:
    // entrada → saída → entrada... que é o comportamento real de um leitor único.
    if (this.isAmbiguousAuto(device.sentido, payload)) {
      const ultimo = await this.prisma.acessos_Facial.findFirst({
        where: {
          id_condominio: device.id_condominio,
          id_pessoa: idPessoa,
          tipo_pessoa: tipoPessoa,
          evento: { in: ['entrada', 'saida'] },
        },
        orderBy: { timestamp: 'desc' },
      });
      evento = ultimo?.evento === 'entrada' ? 'saida' : 'entrada';
    }

    // Rede de segurança anti falso positivo: se o terminal tem confiança mínima
    // configurada e o match veio abaixo dela, NEGA (a identificação não é
    // confiável o suficiente). 0 = desligado; confiança ausente não bloqueia.
    if (confiancaInsuficiente(confianca, device.confianca_minima ?? 0)) {
      await this.prisma.acessos_Facial.create({
        data: {
          id_condominio: device.id_condominio,
          id_device: device.id,
          tipo_dispositivo: device.tipo,
          face_id:
            faceIdSalvo ||
            qrCodeLido ||
            tagRfidLida ||
            externalId ||
            'desconhecido',
          tipo_pessoa: tipoPessoa,
          id_pessoa: idPessoa,
          nome_pessoa: `${nomePessoa} (Bloqueado por baixa confiança)`,
          evento: 'negado',
          confianca,
          timestamp,
        },
      });
      throw new BadRequestException(
        `Acesso negado: confiança do reconhecimento (${
          confianca != null
            ? Math.round(confianca <= 1 ? confianca * 100 : confianca) + '%'
            : 'não informada'
        }) abaixo do mínimo de ${device.confianca_minima}% deste terminal.`,
      );
    }

    // Regra: Visitantes e Prestadores só podem acessar se a entrada foi ativamente liberada/registrada via app ou web
    if (tipoPessoa === 'visitante' || tipoPessoa === 'prestador') {
      const v = await this.prisma.visitantes.findUnique({
        where: { id: idPessoa },
      });
      if (!v) {
        throw new NotFoundException(
          'Cadastro de visitante/prestador não encontrado',
        );
      }

      if (evento === 'entrada') {
        // Validação de janela temporal (Vigência da visita/agendamento)
        const now = timestamp;
        const inicio = v.data_hora_inicio ? new Date(v.data_hora_inicio) : now;
        const termino = v.data_hora_termino
          ? new Date(v.data_hora_termino)
          : null;

        const GRACE_PERIOD_MS = 15 * 60 * 1000;
        const inicioComTolerancia = new Date(
          inicio.getTime() - GRACE_PERIOD_MS,
        );

        if (now < inicioComTolerancia) {
          await this.prisma.acessos_Facial.create({
            data: {
              id_condominio: device.id_condominio,
              id_device: device.id,
              tipo_dispositivo: device.tipo,
              face_id:
                faceIdSalvo ||
                qrCodeLido ||
                tagRfidLida ||
                externalId ||
                'desconhecido',
              tipo_pessoa: tipoPessoa,
              id_pessoa: idPessoa,
              nome_pessoa: `${nomePessoa} (Bloqueado por validade futura)`,
              evento: 'negado',
              confianca,
              timestamp,
            },
          });
          throw new BadRequestException(
            'Acesso negado: O período de validade desta autorização ainda não iniciou.',
          );
        }

        if (termino) {
          const terminoComTolerancia = new Date(
            termino.getTime() + GRACE_PERIOD_MS,
          );
          if (now > terminoComTolerancia) {
            // Se expirou temporalmente, revoga a flag liberado no banco para 0
            await this.prisma.visitantes.update({
              where: { id: v.id },
              data: { liberado: 0 },
            });
            // Rede de segurança: remove o rosto do aparelho (em background) para
            // que a PRÓXIMA tentativa seja negada FISICAMENTE, não só na nuvem.
            void this.syncVisitante(v.id).catch((err) =>
              this.logger.warn(
                `Re-sync pós-expiração do visitante ${v.id} falhou: ${err?.message ?? err}`,
              ),
            );

            await this.prisma.acessos_Facial.create({
              data: {
                id_condominio: device.id_condominio,
                id_device: device.id,
                tipo_dispositivo: device.tipo,
                face_id:
                  faceIdSalvo ||
                  qrCodeLido ||
                  tagRfidLida ||
                  externalId ||
                  'desconhecido',
                tipo_pessoa: tipoPessoa,
                id_pessoa: idPessoa,
                nome_pessoa: `${nomePessoa} (Bloqueado por validade expirada)`,
                evento: 'negado',
                confianca,
                timestamp,
              },
            });
            throw new BadRequestException(
              'Acesso negado: O período de validade desta autorização já expirou.',
            );
          }
        }

        // Validação de dias da semana autorizados
        if (v.dias_semana) {
          const diasPermitidos = v.dias_semana
            .split(',')
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean);
          if (diasPermitidos.length > 0) {
            const mapDias = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
            const diaSemanaAtual = mapDias[now.getDay()];
            if (!diasPermitidos.includes(diaSemanaAtual)) {
              await this.prisma.acessos_Facial.create({
                data: {
                  id_condominio: device.id_condominio,
                  id_device: device.id,
                  tipo_dispositivo: device.tipo,
                  face_id:
                    faceIdSalvo ||
                    qrCodeLido ||
                    tagRfidLida ||
                    externalId ||
                    'desconhecido',
                  tipo_pessoa: tipoPessoa,
                  id_pessoa: idPessoa,
                  nome_pessoa: `${nomePessoa} (Bloqueado por dia da semana não autorizado)`,
                  evento: 'negado',
                  confianca,
                  timestamp,
                },
              });
              throw new BadRequestException(
                'Acesso negado: Entrada não permitida no dia de hoje.',
              );
            }
          }
        }

        if (v.liberado !== 1) {
          await this.prisma.acessos_Facial.create({
            data: {
              id_condominio: device.id_condominio,
              id_device: device.id,
              tipo_dispositivo: device.tipo,
              face_id:
                faceIdSalvo ||
                qrCodeLido ||
                tagRfidLida ||
                externalId ||
                'desconhecido',
              tipo_pessoa: tipoPessoa,
              id_pessoa: idPessoa,
              nome_pessoa: `${nomePessoa} (Bloqueado por falta de liberação)`,
              evento: 'negado',
              confianca,
              timestamp,
            },
          });
          throw new BadRequestException(
            'Acesso negado: A entrada deste visitante não foi autorizada pelo morador ou portaria.',
          );
        }
      } else if (evento === 'saida') {
        if (!v.data_entrada || v.data_saida) {
          await this.prisma.acessos_Facial.create({
            data: {
              id_condominio: device.id_condominio,
              id_device: device.id,
              tipo_dispositivo: device.tipo,
              face_id:
                faceIdSalvo ||
                qrCodeLido ||
                tagRfidLida ||
                externalId ||
                'desconhecido',
              tipo_pessoa: tipoPessoa,
              id_pessoa: idPessoa,
              nome_pessoa: `${nomePessoa} (Bloqueado por não estar no condomínio)`,
              evento: 'negado',
              confianca,
              timestamp,
            },
          });
          throw new BadRequestException(
            'Acesso negado: Este visitante não possui uma entrada ativa no condomínio para poder registrar saída.',
          );
        }
      }
    }

    // Validação de Regras de Acesso (Sprint 3 com Horários e Sentidos)
    const regrasDispositivo = await this.prisma.regras_Acesso.findMany({
      where: {
        id_condominio: device.id_condominio,
        ativo: 1,
        dispositivos: {
          some: {
            id_dispositivo: device.id,
          },
        },
      },
    });

    if (regrasDispositivo.length > 0) {
      // Modelo WHITELIST (engine extraída em access-rules.util.ts, testada
      // exaustivamente). Se o terminal tem regras ativas, só passa se alguma
      // cobrir simultaneamente sentido + horário + categoria; senão, NEGA.
      const horaMinutoAtual = timestamp.toTimeString().substring(0, 5); // "HH:MM"

      if (
        bloqueadoPorRegrasAcesso(
          regrasDispositivo as unknown as RegraAcessoLike[],
          evento,
          tipoPessoa as CategoriaPessoa,
          horaMinutoAtual,
        )
      ) {
        await this.prisma.acessos_Facial.create({
          data: {
            id_condominio: device.id_condominio,
            id_device: device.id,
            tipo_dispositivo: device.tipo,
            face_id:
              faceIdSalvo ||
              qrCodeLido ||
              tagRfidLida ||
              externalId ||
              'desconhecido',
            tipo_pessoa: tipoPessoa,
            id_pessoa: idPessoa,
            nome_pessoa: `${nomePessoa} (Bloqueado por Regra de Acesso)`,
            evento: 'negado',
            confianca,
            timestamp,
          },
        });

        const sentidoLabel =
          evento === 'entrada'
            ? 'entrada'
            : evento === 'saida'
              ? 'saída'
              : evento;
        const categoriaLabel =
          tipoPessoa === 'morador'
            ? 'Moradores'
            : tipoPessoa === 'prestador'
              ? 'Prestadores'
              : tipoPessoa === 'funcionario'
                ? 'Funcionários'
                : 'Visitantes';
        throw new BadRequestException(
          `Acesso negado: as regras deste terminal não permitem ${sentidoLabel} para ${categoriaLabel} neste horário.`,
        );
      }
    }

    // Controle de Anti-passback (Evita registro duplicado sequencial de entrada ou saída).
    //
    // Para VISITANTE/PRESTADOR o estado real é data_entrada/data_saida do próprio
    // registro, já validado acima (saída exige entrada ativa; entrada não duplica).
    // Basear o anti-passback no histórico de eventos aqui causava falso bloqueio:
    // um evento de saída antigo em Acessos_Facial barrava nova saída mesmo o
    // visitante estando DENTRO (data_saida=null) — agravado por registros
    // duplicados da mesma pessoa. Por isso só aplicamos este anti-passback a
    // morador/funcionário, que não têm data_entrada/data_saida persistidas.
    const aplicarAntiPassbackEvento =
      tipoPessoa === 'morador' || tipoPessoa === 'funcionario';
    if (
      aplicarAntiPassbackEvento &&
      (evento === 'entrada' || evento === 'saida')
    ) {
      const ultimoAcesso = await this.prisma.acessos_Facial.findFirst({
        where: {
          tipo_pessoa: tipoPessoa,
          id_pessoa: idPessoa,
          evento: { in: ['entrada', 'saida'] },
        },
        orderBy: { timestamp: 'desc' },
      });

      if (ultimoAcesso && ultimoAcesso.evento === evento) {
        await this.prisma.acessos_Facial.create({
          data: {
            id_condominio: device.id_condominio,
            id_device: device.id,
            tipo_dispositivo: device.tipo,
            face_id:
              faceIdSalvo ||
              qrCodeLido ||
              tagRfidLida ||
              externalId ||
              'desconhecido',
            tipo_pessoa: tipoPessoa,
            id_pessoa: idPessoa,
            nome_pessoa: `${nomePessoa} (Bloqueado por Anti-passback)`,
            evento: 'negado',
            confianca,
            timestamp,
          },
        });

        const sentidoLabel = evento === 'entrada' ? 'entrada' : 'saída';
        throw new BadRequestException(
          `Acesso negado: O usuário já registrou uma ${sentidoLabel} e não pode registrar outra sequencialmente (Regra de Anti-passback).`,
        );
      }
    }

    // Anti-passback em memória (AccessStateService): estado dentro/fora por
    // condomínio, configurável via ANTI_PASSBACK_MODE (off/soft/hard). Estava
    // implementado mas nunca era chamado — código morto. Cobre crachá clonado
    // tentando entrar enquanto o original está dentro, cenário que o
    // anti-passback por histórico acima não pega para visitante/prestador.
    // "off" (default) só acumula estado; "soft" deixa passar mas marca o
    // registro como suspeito; "hard" nega. Estado é perdido em restart
    // (limitação documentada no serviço — mitigar com Redis se houver SLA).
    if (evento === 'entrada' || evento === 'saida') {
      const apb = this.accessState.checkAntiPassback(
        device.id_condominio,
        tipoPessoa,
        idPessoa,
        evento,
      );
      if (apb === 'deny') {
        await this.prisma.acessos_Facial.create({
          data: {
            id_condominio: device.id_condominio,
            id_device: device.id,
            tipo_dispositivo: device.tipo,
            face_id:
              faceIdSalvo ||
              qrCodeLido ||
              tagRfidLida ||
              externalId ||
              'desconhecido',
            tipo_pessoa: tipoPessoa,
            id_pessoa: idPessoa,
            nome_pessoa: `${nomePessoa} (Bloqueado por Anti-passback)`,
            evento: 'negado',
            confianca,
            timestamp,
          },
        });
        const sentidoLabel = evento === 'entrada' ? 'entrada' : 'saída';
        throw new BadRequestException(
          `Acesso negado: ${sentidoLabel} repetida detectada (Anti-passback). Procure a portaria.`,
        );
      }
      if (apb === 'allow_with_warning') {
        // Modo soft: o acesso passa, mas o registro fica marcado para auditoria.
        nomePessoa = `${nomePessoa} (Suspeita de anti-passback)`;
      }
    }

    if (tipoPessoa === 'morador') {
      await this.prisma.acessos_Facial.create({
        data: {
          id_condominio: device.id_condominio,
          id_device: device.id,
          tipo_dispositivo: device.tipo,
          face_id: faceIdSalvo,
          tipo_pessoa: 'morador',
          id_pessoa: idPessoa,
          nome_pessoa: nomePessoa,
          evento,
          confianca,
          timestamp,
        },
      });
    } else {
      const isEntrada = evento === 'entrada';
      const v = await this.prisma.visitantes.findUnique({
        where: { id: idPessoa },
      });
      if (!v)
        throw new NotFoundException(
          'Cadastro de visitante/prestador não encontrado',
        );

      // Updates ATÔMICOS com guarda no where: a validação feita acima leu o
      // visitante num findUnique separado, então dois webhooks simultâneos da
      // mesma credencial (leitor com bounce, tag clonada em dois leitores)
      // passavam ambos pela validação antes de qualquer um gravar. A condição
      // no where garante que só UM update vence; count===0 significa que outro
      // evento concorrente chegou primeiro (ou a liberação foi revogada) e
      // este deve ser negado.
      if (isEntrada) {
        const r = await this.prisma.visitantes.updateMany({
          where: { id: v.id, liberado: 1 },
          data: { data_entrada: timestamp, data_saida: null },
        });
        if (r.count === 0) {
          await this.prisma.acessos_Facial.create({
            data: {
              id_condominio: device.id_condominio,
              id_device: device.id,
              tipo_dispositivo: device.tipo,
              face_id: faceIdSalvo,
              tipo_pessoa: v.is_prestador === 1 ? 'prestador' : 'visitante',
              id_pessoa: v.id,
              nome_pessoa: `${nomePessoa} (Bloqueado por liberação revogada/concorrência)`,
              evento: 'negado',
              confianca,
              timestamp,
            },
          });
          throw new BadRequestException(
            'Acesso negado: A liberação deste visitante foi revogada ou já consumida.',
          );
        }
      } else if (evento === 'saida') {
        const r = await this.prisma.visitantes.updateMany({
          where: { id: v.id, data_entrada: { not: null }, data_saida: null },
          data: {
            data_saida: timestamp,
            ...(device.tipo === 'qrcode_reader' ? { codigo_acesso: null } : {}),
            liberado: v.is_prestador === 1 ? 1 : 0,
          },
        });
        if (r.count === 0) {
          await this.prisma.acessos_Facial.create({
            data: {
              id_condominio: device.id_condominio,
              id_device: device.id,
              tipo_dispositivo: device.tipo,
              face_id: faceIdSalvo,
              tipo_pessoa: v.is_prestador === 1 ? 'prestador' : 'visitante',
              id_pessoa: v.id,
              nome_pessoa: `${nomePessoa} (Bloqueado por saída duplicada/concorrência)`,
              evento: 'negado',
              confianca,
              timestamp,
            },
          });
          throw new BadRequestException(
            'Acesso negado: Este visitante não possui uma entrada ativa no condomínio para poder registrar saída.',
          );
        }

        // Saiu: a autorização do visitante (não-prestador) foi consumida
        // (liberado=0). Re-sincroniza em background para REMOVER o rosto do
        // aparelho — senão ele continuaria abrindo no próximo reconhecimento,
        // mesmo a nuvem negando. syncVisitante decide (prestador permanece).
        void this.syncVisitante(v.id).catch((err) =>
          this.logger.warn(
            `Re-sync pós-saída do visitante ${v.id} falhou: ${err?.message ?? err}`,
          ),
        );
      }

      await this.prisma.acessos_Facial.create({
        data: {
          id_condominio: device.id_condominio,
          id_device: device.id,
          tipo_dispositivo: device.tipo,
          face_id: faceIdSalvo,
          tipo_pessoa: v.is_prestador === 1 ? 'prestador' : 'visitante',
          id_pessoa: v.id,
          nome_pessoa: nomePessoa,
          evento,
          confianca,
          timestamp,
        },
      });

      if (evento === 'entrada' || evento === 'saida') {
        try {
          const moradores = await this.prisma.users.findMany({
            where: {
              apartamentosUsers: { some: { id_apto: v.id_apartamento } },
              fcm_token: { not: null },
              notif_visitantes: 1,
            },
            select: { fcm_token: true },
          });
          const label = v.is_prestador === 1 ? 'Prestador' : 'Visitante';
          const titulo =
            evento === 'entrada' ? `${label} entrou` : `${label} saiu`;
          const corpo =
            evento === 'entrada'
              ? `${v.nome} acabou de entrar no condomínio.`
              : `${v.nome} acabou de sair do condomínio.`;
          for (const u of moradores) {
            if (u.fcm_token) {
              await this.notifications.sendPushNotification(
                u.fcm_token,
                titulo,
                corpo,
                { id: v.id.toString(), type: 'visitante_acesso' },
              );
            }
          }
        } catch (err) {
          this.logger.warn(`Push de acesso falhou: ${err}`);
        }
      }
    }

    // === PONTE: leitor identificou → aciona dispositivo de abertura ===
    //
    // Leitores RFID e QR Code só LEEM credenciais — eles não abrem a porta
    // sozinhos. Quando o webhook recebe uma identificação bem-sucedida
    // desses tipos, automaticamente acionamos todas as botoeiras e catracas
    // ativas do mesmo condomínio.
    //
    // Cenário típico: condomínio tem 1 leitor RFID na entrada + 1 botoeira
    // que abre o portão. Morador encosta o crachá → leitor identifica →
    // ponte aciona botoeira → portão abre.
    //
    // Para setups com múltiplas entradas, configure Regras_Dispositivos:
    // crie uma regra ativa que inclua o leitor X E a(s) abertura(s) que ele
    // deve acionar. Só essas aberturas serão disparadas.
    //
    // Se NENHUMA regra mapeia o leitor para aberturas específicas, cai no
    // fallback: aciona todas as aberturas ativas do condomínio (comportamento
    // legado, útil pra condomínios simples com 1 entrada).
    //
    // Apenas eventos de ENTRADA disparam acionamento — saídas não precisam.
    const isLeitor =
      device.tipo === 'tag_reader' || device.tipo === 'qrcode_reader';
    if (isLeitor && evento === 'entrada') {
      // Busca aberturas vinculadas a esse leitor via regras ativas.
      // Uma regra que tenha o leitor E aberturas define o roteamento.
      const regrasDoLeitor = await this.prisma.regras_Acesso.findMany({
        where: {
          id_condominio: device.id_condominio,
          ativo: 1,
          dispositivos: { some: { id_dispositivo: device.id } },
        },
        include: {
          dispositivos: {
            include: { dispositivo: true },
          },
        },
      });

      const aberturasMapeadas = new Map<number, typeof device>();
      for (const regra of regrasDoLeitor) {
        for (const link of regra.dispositivos) {
          const d = link.dispositivo;
          if (
            d &&
            d.id !== device.id &&
            d.ativo === 1 &&
            (d.tipo === 'botoeira' || d.tipo === 'catraca')
          ) {
            aberturasMapeadas.set(d.id, d as any);
          }
        }
      }

      const aberturasParaAcionar =
        aberturasMapeadas.size > 0
          ? Array.from(aberturasMapeadas.values())
          : await this.prisma.facial_Devices.findMany({
              where: {
                id_condominio: device.id_condominio,
                ativo: 1,
                tipo: { in: ['botoeira', 'catraca'] },
              },
            });

      if (aberturasMapeadas.size === 0) {
        this.logger.warn(
          `Ponte usando FALLBACK (sem mapeamento): leitor ${device.id} acionando todas as aberturas do condomínio`,
        );
      }

      for (const abertura of aberturasParaAcionar) {
        try {
          const result = await this.client.triggerRelay(
            this.toConfig(abertura),
          );
          await this.prisma.acessos_Facial.create({
            data: {
              id_condominio: device.id_condominio,
              id_device: abertura.id,
              tipo_dispositivo: abertura.tipo,
              face_id: faceIdSalvo || 'ponte_auto',
              tipo_pessoa: tipoPessoa,
              id_pessoa: idPessoa,
              nome_pessoa: result.ok
                ? `${nomePessoa} (acionado por ${device.nome})`
                : `${nomePessoa} (FALHA ao acionar ${abertura.nome})`,
              evento: result.ok ? 'acionado_auto' : 'falha_acionamento',
              timestamp: new Date(),
            },
          });
          if (!result.ok) {
            this.logger.warn(
              `Ponte falhou: leitor ${device.id} identificou ${nomePessoa} mas trigger em ${abertura.id} (${abertura.nome}) deu erro: ${result.error ?? result.statusCode}`,
            );
          }
        } catch (err: any) {
          this.logger.warn(
            `Ponte erro inesperado: leitor ${device.id} → abertura ${abertura.id}: ${err?.message ?? err}`,
          );
        }
      }
    }

    return { ok: true, tipo: tipoPessoa, id: idPessoa, evento };
  }

  async listAcessos(idCondominio: number, limit = 50) {
    const list = await this.prisma.acessos_Facial.findMany({
      where: { id_condominio: idCondominio },
      orderBy: { timestamp: 'desc' },
      take: Math.min(limit, 200),
    });
    return list.map((a) => {
      let observacao = null;
      const match = a.nome_pessoa.match(/\(([^)]+)\)/);
      if (match) {
        observacao = match[1];
      }
      return {
        ...a,
        observacao,
      };
    });
  }

  async listAcessosPessoa(
    tipo: 'morador' | 'visitante',
    idPessoa: number,
    limit = 30,
  ) {
    if (tipo === 'morador') {
      const list = await this.prisma.acessos_Facial.findMany({
        where: { tipo_pessoa: tipo, id_pessoa: idPessoa },
        orderBy: { timestamp: 'desc' },
        take: Math.min(limit, 100),
      });
      return list.map((a) => {
        let observacao = null;
        const match = a.nome_pessoa.match(/\(([^)]+)\)/);
        if (match) {
          observacao = match[1];
        }
        return {
          ...a,
          observacao,
        };
      });
    }

    // Para visitantes, precisamos consolidar o histórico completo (acessos faciais + PIN/manual) de todas as visitas da mesma identidade
    const v = await this.prisma.visitantes.findUnique({
      where: { id: idPessoa },
    });
    if (!v) return [];

    const todasVisitas = await this.prisma.visitantes.findMany({
      where: {
        id_condominio: v.id_condominio,
        nome: v.nome,
        doc_identificacao: v.doc_identificacao || undefined,
      },
      orderBy: { created_at: 'desc' },
    });
    const todosVisIds = todasVisitas.map((x) => x.id);

    const acessosFacial =
      todosVisIds.length > 0
        ? await this.prisma.acessos_Facial.findMany({
            where: {
              tipo_pessoa: 'visitante',
              id_pessoa: { in: todosVisIds },
            },
            orderBy: { timestamp: 'desc' },
            take: 100,
          })
        : [];

    // Deduplicação (evita duplicar se casar com acesso facial)
    const DEDUP_MS = 15_000;
    const facialBuckets = new Set<string>();
    for (const a of acessosFacial) {
      const b = Math.floor(a.timestamp.getTime() / DEDUP_MS);
      facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b}`);
      facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b - 1}`);
      facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b + 1}`);
    }
    const isDup = (idVis: number, evento: 'entrada' | 'saida', ts: Date) => {
      const b = Math.floor(ts.getTime() / DEDUP_MS);
      return facialBuckets.has(`${idVis}:${evento}:${b}`);
    };

    type MergedEntry = {
      id: number;
      id_condominio: number;
      id_device?: number | null;
      tipo_dispositivo?: string | null;
      face_id?: string | null;
      tipo_pessoa: 'visitante';
      id_pessoa: number;
      nome_pessoa: string;
      evento: 'entrada' | 'saida' | 'negado';
      confianca?: number | null;
      timestamp: Date;
      observacao?: string | null;
    };

    const mergedList: MergedEntry[] = [];

    // Adiciona acessos faciais
    for (const a of acessosFacial) {
      let observacao = null;
      const match = a.nome_pessoa.match(/\(([^)]+)\)/);
      if (match) {
        observacao = match[1];
      }
      mergedList.push({
        id: a.id,
        id_condominio: a.id_condominio,
        id_device: a.id_device,
        tipo_dispositivo: a.tipo_dispositivo,
        face_id: a.face_id,
        tipo_pessoa: 'visitante',
        id_pessoa: a.id_pessoa!,
        nome_pessoa: a.nome_pessoa,
        evento:
          a.evento === 'saida'
            ? 'saida'
            : a.evento === 'negado'
              ? 'negado'
              : 'entrada',
        confianca: a.confianca,
        timestamp: a.timestamp,
        observacao,
      });
    }

    // Adiciona entradas/saídas por PIN/manual
    for (const reg of todasVisitas) {
      if (reg.data_entrada && !isDup(reg.id, 'entrada', reg.data_entrada)) {
        mergedList.push({
          id: reg.id * 1000 + 1,
          id_condominio: reg.id_condominio,
          tipo_dispositivo: 'pin',
          tipo_pessoa: 'visitante',
          id_pessoa: reg.id,
          nome_pessoa: reg.nome,
          evento: 'entrada',
          timestamp: reg.data_entrada,
        });
      }
      if (reg.data_saida && !isDup(reg.id, 'saida', reg.data_saida)) {
        mergedList.push({
          id: reg.id * 1000 + 2,
          id_condominio: reg.id_condominio,
          tipo_dispositivo: 'pin',
          tipo_pessoa: 'visitante',
          id_pessoa: reg.id,
          nome_pessoa: reg.nome,
          evento: 'saida',
          timestamp: reg.data_saida,
        });
      }
    }

    mergedList.sort((x, y) => y.timestamp.getTime() - x.timestamp.getTime());
    return mergedList.slice(0, limit);
  }

  // ---------- Helpers ----------

  private toConfig(device: any): FacialDeviceConfig {
    return {
      id: device.id,
      ip: device.ip,
      porta: device.porta,
      api_user: device.api_user,
      // Idempotente: decifra se vier cifrado; texto puro passa direto.
      api_password: decryptSecret(device.api_password),
      fabricante: device.fabricante,
    };
  }

  private parseExternalId(externalId: string): { tipo: string; id: number } {
    const match = externalId.match(/^(morador|visitante)_(\d+)$/);
    if (!match) return { tipo: 'desconhecido', id: 0 };
    return { tipo: match[1], id: Number(match[2]) };
  }

  /**
   * Escolhe o registro de visitante CORRETO quando a mesma credencial (tag/QR)
   * aparece em vários registros da mesma pessoa (várias visitas).
   *
   * - SAÍDA: prioriza quem está DENTRO (data_entrada != null, data_saida == null).
   *   Um findFirst ingênuo pegava um registro sem entrada ativa e negava a saída.
   * - ENTRADA/demais: prioriza quem está liberado e ainda NÃO entrou nem saiu
   *   (a visita "agendada/pronta"); senão o registro mais recente.
   */
  private async findVisitanteByCredencial(
    where: { id_condominio: number; codigo_acesso?: string; tag_rfid?: string },
    evento: string,
  ) {
    const candidatos = await this.prisma.visitantes.findMany({ where });
    if (candidatos.length <= 1) return candidatos[0] ?? null;

    if (evento === 'saida') {
      // Está dentro agora = entrou e não saiu. Entre vários, o de entrada mais recente.
      const dentro = candidatos
        .filter((v) => v.data_entrada && !v.data_saida)
        .sort((a, b) => b.data_entrada!.getTime() - a.data_entrada!.getTime());
      if (dentro.length) return dentro[0];
    } else {
      // Entrada: prefere visita liberada e ainda não usada (sem entrada/saída).
      const prontos = candidatos
        .filter((v) => v.liberado === 1 && !v.data_entrada && !v.data_saida)
        .sort((a, b) => b.id - a.id);
      if (prontos.length) return prontos[0];
    }
    // Fallback: registro mais recente.
    return candidatos.sort((a, b) => b.id - a.id)[0];
  }

  /**
   * Converte o push nativo do Control iD (Monitor, formato "object_changes")
   * para o nosso WebhookEventDto. Retorna null se não for esse formato (deixa
   * passar o formato limpo do simulador/integrações).
   *
   * Formato Control iD (validado contra a doc oficial):
   *   { object_changes: [{ object: 'access_logs', values: {
   *       time, event, device_id, user_id, portal_id, ... } }], device_id }
   *
   * - user_id é o id INTERNO do aparelho — gravamos ele em face_id no
   *   enrollment, então o webhook resolve a pessoa por face_id.
   * - user_id "0" = ninguém identificado → acesso negado.
   * - Direção (entrada/saída) NÃO vem no log (depende do portal). Assumimos
   *   ENTRADA, caso comum de terminal único na entrada. Para catraca com
   *   entrada/saída separadas, mapear por portal_id futuramente.
   */
  private normalizeControlIdPayload(raw: unknown): WebhookEventDto | null {
    const obj = raw as any;
    const changes = obj?.object_changes;
    if (!Array.isArray(changes)) return null;
    const entry = changes.find((c) => c?.object === 'access_logs' && c?.values);
    if (!entry) return null;
    const v = entry.values;
    const userId = v.user_id != null ? String(v.user_id) : '';
    const identificado = userId !== '' && userId !== '0';
    return {
      person_id: identificado ? userId : undefined,
      external_id: identificado ? userId : undefined,
      event: identificado ? 'access_granted' : 'access_denied',
      timestamp: v.time
        ? new Date(Number(v.time) * 1000).toISOString()
        : undefined,
      // Direção fica a cargo do device.sentido (o push do Control iD não diz).
    };
  }

  /**
   * Decide entrada/saída/negado do evento considerando o SENTIDO configurado
   * no terminal — peça-chave de um controle de acesso profissional:
   *   - negado continua negado (validação de identidade falhou)
   *   - terminal 'entrada' → sempre entrada
   *   - terminal 'saida'   → sempre saída (dá baixa)
   *   - 'auto'             → respeita o que o aparelho informou (direction/event);
   *                          se não informar, cai em entrada
   */
  private resolveEvento(
    sentido: string | undefined,
    payload: WebhookEventDto,
  ): string {
    const base = this.normalizeEvento(payload.event, payload.direction);
    if (base === 'negado') return 'negado';
    if (sentido === 'entrada') return 'entrada';
    if (sentido === 'saida') return 'saida';
    return base;
  }

  /**
   * Terminal em sentido "auto" cujo evento NÃO traz direção (nem `direction`,
   * nem entrada/saída no `event`). É o caso dos faciais Intelbras/Dahua, que só
   * reportam o reconhecimento. Nesse cenário a direção é alternada pelo último
   * acesso da pessoa (ver runWebhook), em vez de assumir sempre "entrada".
   */
  private isAmbiguousAuto(
    sentido: string | undefined,
    payload: WebhookEventDto,
  ): boolean {
    const autoSentido = !sentido || sentido === 'auto';
    const semDirecao =
      !payload.direction &&
      !/entrada|sa[ií]da|exit|\bin\b|\bout\b/i.test(payload.event ?? '');
    return autoSentido && semDirecao;
  }

  private normalizeEvento(event?: string, direction?: string): string {
    const e = (event ?? '').toLowerCase();
    const d = (direction ?? '').toLowerCase();
    if (e.includes('denied') || e.includes('negado')) return 'negado';
    if (d === 'in' || e.includes('granted') || e.includes('entrada'))
      return 'entrada';
    if (d === 'out' || e.includes('saida') || e.includes('exit'))
      return 'saida';
    return 'entrada';
  }

  private async fetchPhotoAsBase64(foto: string): Promise<string | null> {
    if (!foto) return null;
    if (foto.startsWith('data:')) {
      const idx = foto.indexOf(',');
      return idx >= 0 ? foto.substring(idx + 1) : foto;
    }
    if (foto.startsWith('http://') || foto.startsWith('https://')) {
      try {
        const axios = (await import('axios')).default;
        const res = await axios.get(foto, {
          responseType: 'arraybuffer',
          timeout: 15000,
        });
        return Buffer.from(res.data).toString('base64');
      } catch (err) {
        this.logger.warn(`Falha baixando foto ${foto}: ${err}`);
        return null;
      }
    }
    // Já é base64 puro
    return foto;
  }

  private async markMoradorSyncStatus(id: number, status: string) {
    try {
      await this.prisma.moradores.update({
        where: { id },
        data: { face_sync_status: status },
      });
    } catch {
      /* noop */
    }
  }

  private async markVisitanteSyncStatus(id: number, status: string) {
    try {
      await this.prisma.visitantes.update({
        where: { id },
        data: { face_sync_status: status },
      });
    } catch {
      /* noop */
    }
  }
}

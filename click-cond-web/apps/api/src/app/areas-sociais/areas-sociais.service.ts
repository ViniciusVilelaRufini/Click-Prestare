import { Injectable, ForbiddenException, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../prisma/generated';

// Client "de dentro" de um `prisma.$transaction(async (tx) => ...)` — mesma
// API do PrismaService, mas as operações só confirmam junto com o resto do
// bloco (ou fazem rollback juntas).
type PrismaTx = Prisma.TransactionClient;
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../common/storage/storage.service';
import { FacialService } from '../facial/facial.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { assertOperador } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';

const DEFAULT_AREA_IMAGE = 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600';

/**
 * Fuso dos condomínios. O servidor (Railway) roda em UTC, os moradores vivem
 * em UTC−3: usar o relógio do servidor faz o "hoje" da agenda virar às 21h
 * (00h UTC) e descarta como vencido bloco que ainda está 3h no futuro para o
 * morador. Todo cálculo de "agora"/"hoje" da agenda passa por aqui.
 * Mesma armadilha documentada em financeiro.service.ts (job de lembretes).
 */
const TIMEZONE_CONDOMINIO = 'America/Sao_Paulo';

@Injectable()
export class AreasSociaisService {
  private readonly logger = new Logger(AreasSociaisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly facial: FacialService,
    private readonly tenant: TenantAccessService,
  ) {}

  /**
   * Vazio/ausente/0 vira `null` no banco — "sem limite", o mesmo estado de
   * todas as 8 áreas hoje. Só um inteiro positivo de fato configura um teto.
   */
  private parseLimiteMensal(valor: unknown): number | null {
    if (valor === undefined || valor === null || valor === '') return null;
    const n = Number(valor);
    if (!Number.isInteger(n) || n <= 0) return null;
    return n;
  }

  private parseTime(timeStr: string | null | undefined): [number, number] {
    const s = String(timeStr ?? '00:00').trim();
    const match = s.match(/(\d{2}):(\d{2})/);
    if (match) {
      return [Number(match[1]), Number(match[2])];
    }
    return [0, 0];
  }

  /**
   * "Agora" no fuso do condomínio, devolvido como Date cujos acessores locais
   * (getFullYear/getHours/...) já falam o relógio de São Paulo. É essa a forma
   * que o resto do cálculo espera, porque os blocos são montados com
   * `new Date(ano, mês, dia, hora, minuto)` — comparar relógio com relógio.
   */
  private agoraNoFusoDoCondominio(): Date {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE_CONDOMINIO,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const p: Record<string, string> = {};
    for (const parte of fmt.formatToParts(new Date())) p[parte.type] = parte.value;
    // hourCycle h23 pode devolver "24" para meia-noite em alguns ICU.
    const hora = p.hour === '24' ? 0 : Number(p.hour);
    return new Date(Number(p.year), Number(p.month) - 1, Number(p.day), hora, Number(p.minute), Number(p.second), 0);
  }

  // Junta uma data (ano/mês/dia) com um horário (hora/minuto), ignorando o
  // "dia" de `time` — no banco hora_inicio/hora_termino são gravados como
  // 1970-01-01 + HH:mm, só o relógio importa.
  //
  // ATENÇÃO: `date`/`time` vêm de colunas DATE/TIME e são lidos com acessores
  // locais, então isto só devolve o relógio certo enquanto o processo estiver
  // em UTC (Railway está; TZ=America/Sao_Paulo no servidor QUEBRARIA isto).
  // A comparação passou a ser contra o "agora" de São Paulo — relógio de
  // parede contra relógio de parede —, então a janela lida aqui precisa ser a
  // do condomínio, não deslocada pelo fuso do processo.
  private combineDateTime(date: Date, time: Date | null | undefined): Date {
    const [h, m] = time ? [time.getHours(), time.getMinutes()] : [0, 0];
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0);
  }

  // Colisão de intervalos [inicio, fim): true quando o bloco intersecta
  // alguma das janelas (parcial ou totalmente), tocar na borda não conta.
  private colideComJanela(inicioBloco: Date, fimBloco: Date, janelas: Array<{ inicio: Date; fim: Date }>): boolean {
    return janelas.some((j) => inicioBloco < j.fim && fimBloco > j.inicio);
  }

  /**
   * Resolve a imagem recebida do front em uma URL curta que caiba no
   * `varchar(500)` da coluna. Se vier um data URL (upload de arquivo),
   * sobe para o storage (R2) e usa a URL pública retornada. Se o upload
   * falhar ou o storage estiver desativado (e portanto devolver o próprio
   * data URL gigante), caímos na imagem padrão para nunca estourar a coluna.
   */
  private async resolveImagem(imagem: unknown): Promise<string> {
    const valor = typeof imagem === 'string' ? imagem : '';

    if (this.storage.isDataUrl(valor)) {
      const uploaded = await this.storage.uploadDataUrl(valor, 'areas-sociais');
      if (uploaded && !this.storage.isDataUrl(uploaded) && uploaded.length <= 500) {
        return uploaded;
      }
      this.logger.warn('Upload da imagem da área falhou ou storage desativado; usando imagem padrão.');
      return DEFAULT_AREA_IMAGE;
    }

    // URL comum digitada manualmente — respeita o limite da coluna.
    if (valor.length > 500) return DEFAULT_AREA_IMAGE;
    return valor;
  }

  // ==========================================
  // GESTÃO DE ÁREAS SOCIAIS
  // ==========================================
  async insert(idCondominio: number, areaSocial: any, user?: JwtPayload) {
    assertOperador(user, 'criar área social');
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) {
      return { success: true };
    }

    // Upload do arquivo de imagem (data URL) ou validação da URL informada.
    const imagemUrl = await this.resolveImagem(areaSocial.imagem);

    const horariosStr = typeof areaSocial.horarios === 'string'
      ? areaSocial.horarios
      : JSON.stringify(areaSocial.horarios ?? []);

    await this.prisma.areas_Sociais.create({
      data: {
        nome: areaSocial.nome,
        imagem: imagemUrl,
        precisa_agendar: Number(areaSocial.agendar ?? areaSocial.precisa_agendar ?? 0),
        precisa_autorizacao: Number(areaSocial.autorizacao ?? areaSocial.precisa_autorizacao ?? 0),
        precisa_pagamento: Number(areaSocial.pagar ?? areaSocial.precisa_pagamento ?? 0),
        horarios: horariosStr,
        capacidade: Number(areaSocial.capacidade ?? 0),
        // Vazio/ausente = sem limite (comportamento de sempre). Só vira teto
        // de verdade quando o síndico digita um número > 0.
        limite_mensal_apto: this.parseLimiteMensal(areaSocial.limite_mensal_apto),
        id_condominio: Number(idCondominio),
        // Regra é texto livre do síndico; sem regra cadastrada o app não
        // exige aceite nenhum (não faz sentido aceitar "o nada").
        regras: typeof areaSocial.regras === 'string' && areaSocial.regras.trim() !== '' ? areaSocial.regras : null,
      },
    });

    return { success: true };
  }

  async update(idCondominio: number, areaSocial: any, user?: JwtPayload) {
    assertOperador(user, 'editar área social');
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) {
      return { success: true };
    }

    const imagemUrl = await this.resolveImagem(areaSocial.imagem);

    const horariosStr = typeof areaSocial.horarios === 'string'
      ? areaSocial.horarios
      : JSON.stringify(areaSocial.horarios ?? []);

    // O app publicado não manda `regras` no payload de edição. Se a chave não
    // veio, a coluna nem entra no update — senão o morador/síndico editando
    // capacidade pelo app apagava silenciosamente o texto cadastrado na web.
    // Chave presente e vazia continua significando "apagar as regras".
    const regrasPatch = areaSocial.regras === undefined
      ? {}
      : { regras: typeof areaSocial.regras === 'string' && areaSocial.regras.trim() !== '' ? areaSocial.regras : null };

    await this.prisma.areas_Sociais.updateMany({
      where: {
        id: Number(areaSocial.id),
        id_condominio: Number(idCondominio),
      },
      data: {
        nome: areaSocial.nome,
        ...(imagemUrl ? { imagem: imagemUrl } : {}),
        precisa_agendar: Number(areaSocial.agendar ?? areaSocial.precisa_agendar ?? 0),
        precisa_autorizacao: Number(areaSocial.autorizacao ?? areaSocial.precisa_autorizacao ?? 0),
        precisa_pagamento: Number(areaSocial.pagar ?? areaSocial.precisa_pagamento ?? 0),
        horarios: horariosStr,
        capacidade: Number(areaSocial.capacidade ?? 0),
        limite_mensal_apto: this.parseLimiteMensal(areaSocial.limite_mensal_apto),
        ...regrasPatch,
      },
    });

    return { success: true };
  }

  async remove(id: number, user?: JwtPayload) {
    assertOperador(user, 'remover área social');
    if (!this.prisma.isConnected) return { success: true };
    const area = await this.prisma.areas_Sociais.findUnique({ where: { id: Number(id) } });
    if (!area) throw new NotFoundException('Área social não encontrada');
    await this.tenant.assertEntidade(area.id_condominio, user, `área social #${id}`);
    await this.prisma.areas_Sociais.delete({ where: { id: Number(id) } });
    return { success: true };
  }

  async getAll(idCondominio: number, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) {
      return [
        { id: 1, nome: 'Churrasqueira Gourmet', imagem: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600' },
        { id: 2, nome: 'Salão de Festas', imagem: 'https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?w=600' },
      ];
    }

    const areas = await this.prisma.areas_Sociais.findMany({
      where: { id_condominio: Number(idCondominio) },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        nome: true,
        imagem: true,
        capacidade: true,
        limite_mensal_apto: true,
        precisa_agendar: true,
        precisa_autorizacao: true,
        precisa_pagamento: true,
        regras: true,
        _count: { select: { devices: true } },
      },
    });

    const defaultImage = 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600';
    const ocupacaoMap = await this.getOcupacaoPorArea(Number(idCondominio));

    return areas.map(a => {
      const { _count, ...rest } = a;
      const temMonitoramento = (_count?.devices ?? 0) > 0;
      return {
        ...rest,
        imagem: a.imagem && a.imagem.trim() !== '' ? a.imagem : defaultImage,
        tem_monitoramento: temMonitoramento,
        ocupacao: temMonitoramento ? (ocupacaoMap.get(a.id) ?? 0) : 0,
      };
    });
  }

  /**
   * Ocupação atual ("quantas pessoas estão dentro agora") por área de lazer,
   * derivada dos acessos faciais/catraca dos dispositivos vinculados à área.
   *
   * Para cada pessoa, entre os dispositivos DAQUELA área, olhamos o último
   * evento entrada/saída do DIA — se for `entrada`, a pessoa está dentro.
   * Contamos pessoas distintas dentro. Reset diário à meia-noite: eventos de
   * ontem não contam (uma `entrada` sem `saída` não fica presa para sempre).
   *
   * Retorna um Map<id_area_social, ocupacao>. Áreas sem ninguém dentro ficam
   * ausentes do Map (o chamador usa 0 como default).
   */
  private async getOcupacaoPorArea(idCondominio: number): Promise<Map<number, number>> {
    const inicioDoDia = new Date();
    inicioDoDia.setHours(0, 0, 0, 0);

    // Agrupa por (área, pessoa) e mantém só o último evento do dia via
    // GROUP_CONCAT ordenado desc + primeiro elemento. Portável (MySQL 5.7+) e,
    // como só lemos o primeiro item, o limite de GROUP_CONCAT não afeta.
    const rows = await this.prisma.$queryRaw<Array<{ area: number; ocupacao: bigint | number }>>`
      SELECT sub.area AS area, COUNT(*) AS ocupacao
      FROM (
        SELECT d.id_area_social AS area,
               COALESCE(CONCAT(af.tipo_pessoa, '#', af.id_pessoa), af.face_id) AS pessoa,
               SUBSTRING_INDEX(
                 GROUP_CONCAT(af.evento ORDER BY af.timestamp DESC, af.id DESC), ',', 1
               ) AS ultimo_evento
        FROM Acessos_Facial af
        JOIN Facial_Devices d
          ON d.id = af.id_device AND d.id_area_social IS NOT NULL
        WHERE af.id_condominio = ${idCondominio}
          AND af.evento IN ('entrada', 'saida')
          AND af.timestamp >= ${inicioDoDia}
        GROUP BY d.id_area_social, pessoa
      ) sub
      WHERE sub.ultimo_evento = 'entrada'
      GROUP BY sub.area
    `;

    const map = new Map<number, number>();
    for (const r of rows) {
      map.set(Number(r.area), Number(r.ocupacao));
    }
    return map;
  }

  async get(idCondominio: number, idArea: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) {
      const mockHorarios = Array.from({ length: 7 }).map(() => ({
        horarios: [{ horarioDe: '10:00', horarioAte: '14:00' }, { horarioDe: '15:00', horarioAte: '22:00' }],
      }));
      return {
        id: idArea,
        nome: 'Churrasqueira Gourmet',
        imagem: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600',
        precisa_agendar: 1,
        precisa_autorizacao: 0,
        precisa_pagamento: 0,
        capacidade: 25,
        horarios: mockHorarios,
        agendamentos: [],
        horarios_livres: {
          '15/05/2026': [{ horarioDe: '10:00', horarioAte: '14:00' }],
        },
        manutencoes: [],
        regras: null,
      };
    }

    const area = await this.prisma.areas_Sociais.findUnique({
      where: { id: Number(idArea) },
    });

    if (!area) throw new NotFoundException('Área social não encontrada');
    await this.tenant.assertEntidade(area.id_condominio, user, `área social #${idArea}`);

    let horariosObj: any[] = [];
    try {
      horariosObj = area.horarios ? JSON.parse(area.horarios) : [];
    } catch {
      horariosObj = [];
    }

    // Relógio do condomínio, não o do servidor (ver TIMEZONE_CONDOMINIO).
    const agora = this.agoraNoFusoDoCondominio();
    const hojeBase = new Date(agora);
    hojeBase.setHours(0, 0, 0, 0);

    // Buscar agendamentos futuros (data > ontem) — ontem também sai do "hoje"
    // do condomínio, senão às 21h BRT (já 00h UTC) as reservas do dia atual do
    // morador ficavam de fora e o horário aparecia como livre.
    const ontem = new Date(hojeBase);
    ontem.setDate(ontem.getDate() - 1);

    const agendamentosDb = await this.prisma.areas_Sociais_Agendamentos.findMany({
      where: {
        id_area_social: Number(idArea),
        data: { gt: ontem },
      },
      include: {
        apartamento: { select: { bloco: true, apto: true } },
      },
      orderBy: [{ data: 'asc' }, { hora_de: 'asc' }],
    });

    // Lista completa devolvida na resposta — é a agenda da área (síndico vê o
    // histórico), então NÃO filtra por status.
    const agendamentos = agendamentosDb.map(ag => {
      const dataStr = ag.data
        ? ag.data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '';
      const horaDeStr = ag.hora_de ? ag.hora_de.toTimeString().substring(0, 5) : '';
      const horaAteStr = ag.hora_ate ? ag.hora_ate.toTimeString().substring(0, 5) : '';

      return {
        id: ag.id,
        bloco: ag.apartamento?.bloco ?? '',
        apto: ag.apartamento?.apto ?? '',
        data: dataStr,
        horaDe: horaDeStr,
        horaAte: horaAteStr,
        status: ag.status,
        convidados: ag.convidados ?? null,
      };
    });

    // Só reserva 'pendente' ou 'aprovado' ocupa de fato o horário — o mesmo
    // filtro que insertAgendamento usa na checagem de conflito. Sem isso uma
    // reserva recusada continuava sumindo com o horário na tela.
    const agendamentosOcupam = agendamentos.filter(ag => ['pendente', 'aprovado'].includes(ag.status));

    // Manutenções desta área que ainda não terminaram — passadas não afetam
    // horário nenhum. Comparação por data+hora combinadas (não só data), já
    // que a manutenção pode terminar no meio do dia.
    const manutencoesDb = await this.prisma.areas_Sociais_Manutencoes.findMany({
      where: { id_area_social: Number(idArea) },
      orderBy: [{ data_inicio: 'asc' }],
    });
    const manutencoesAtivas = manutencoesDb
      // Linha sem data de início ou término não delimita janela nenhuma: cair
      // no epoch criava 1970 → término, que intersecta TUDO e deixava a área
      // sem nenhum horário disponível.
      .filter(m => m.data_inicio != null && m.data_termino != null)
      .map(m => ({
        raw: m,
        inicio: this.combineDateTime(m.data_inicio as Date, m.hora_inicio),
        fim: this.combineDateTime(m.data_termino as Date, m.hora_termino),
      }))
      .filter(m => m.fim > agora);

    // Calcular horários livres para 60 dias, incluindo hoje
    const horariosLivres: Record<string, any[]> = {};

    for (let i = 0; i < 60; i++) {
      const currDate = new Date(hojeBase);
      currDate.setDate(currDate.getDate() + i);
      // currDate já carrega o dia do condomínio (veio de hojeBase), então a
      // chave dd/MM/yyyy e as comparações abaixo falam do mesmo dia.
      const dataFormatada = currDate.toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
      // Lógica de dia da semana do legado (Segunda = 0, Domingo = 6)
      const dayRaw = currDate.getDay();
      const weekDay = dayRaw - 1 < 0 ? 6 : dayRaw - 1;
      const ehHoje = i === 0;

      if (horariosObj[weekDay] && Array.isArray(horariosObj[weekDay].horarios) && horariosObj[weekDay].horarios.length > 0) {
        let blocos: any[] = JSON.parse(JSON.stringify(horariosObj[weekDay].horarios));

        if (ehHoje) {
          // Hoje: descarta bloco cujo fim já passou — oferecer horário vencido
          // troca um defeito por outro.
          blocos = blocos.filter(h => {
            const [hAte, mAte] = this.parseTime(h.horarioAte);
            const fimBloco = new Date(currDate.getFullYear(), currDate.getMonth(), currDate.getDate(), hAte, mAte, 0, 0);
            return fimBloco > agora;
          });
        }

        // Remove bloco que intersecta alguma janela de manutenção ativa.
        blocos = blocos.filter(h => {
          const [hDe, mDe] = this.parseTime(h.horarioDe);
          const [hAte, mAte] = this.parseTime(h.horarioAte);
          const inicioBloco = new Date(currDate.getFullYear(), currDate.getMonth(), currDate.getDate(), hDe, mDe, 0, 0);
          const fimBloco = new Date(currDate.getFullYear(), currDate.getMonth(), currDate.getDate(), hAte, mAte, 0, 0);
          return !this.colideComJanela(inicioBloco, fimBloco, manutencoesAtivas);
        });

        if (blocos.length > 0) {
          horariosLivres[dataFormatada] = blocos;
        }
      }
    }

    // Remover horários já ocupados por reserva ativa (pendente/aprovado)
    agendamentosOcupam.forEach(ag => {
      const dataAg = ag.data;
      if (horariosLivres[dataAg]) {
        horariosLivres[dataAg] = horariosLivres[dataAg].filter(h => {
          const isMesmo = h.horarioDe === ag.horaDe && h.horarioAte === ag.horaAte;
          return !isMesmo;
        });

        if (horariosLivres[dataAg].length === 0) {
          delete horariosLivres[dataAg];
        }
      }
    });

    // Campo adicional para a tela explicar por que um dia sumiu.
    const manutencoes = manutencoesAtivas.map(m => ({
      id: m.raw.id,
      descricao: m.raw.descricao ?? '',
      data_inicio: m.raw.data_inicio
        ? m.raw.data_inicio.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '',
      hora_inicio: m.raw.hora_inicio ? m.raw.hora_inicio.toTimeString().substring(0, 5) : '',
      data_termino: m.raw.data_termino
        ? m.raw.data_termino.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '',
      hora_termino: m.raw.hora_termino ? m.raw.hora_termino.toTimeString().substring(0, 5) : '',
    }));

    // Ocupação atual desta área (contador "quantas pessoas estão dentro agora").
    const [ocupacaoMap, devicesCount] = await Promise.all([
      this.getOcupacaoPorArea(area.id_condominio),
      this.prisma.facial_Devices.count({ where: { id_area_social: area.id } }),
    ]);
    const temMonitoramento = devicesCount > 0;

    return {
      id: area.id,
      nome: area.nome,
      imagem: area.imagem ?? '',
      precisa_agendar: area.precisa_agendar,
      precisa_autorizacao: area.precisa_autorizacao,
      precisa_pagamento: area.precisa_pagamento,
      capacidade: area.capacidade ?? 0,
      limite_mensal_apto: area.limite_mensal_apto ?? null,
      id_condominio: area.id_condominio,
      tem_monitoramento: temMonitoramento,
      ocupacao: temMonitoramento ? (ocupacaoMap.get(area.id) ?? 0) : 0,
      horarios: horariosObj,
      agendamentos,
      horarios_livres: horariosLivres,
      manutencoes,
      regras: area.regras ?? null,
    };
  }

  // ==========================================
  // AGENDAMENTOS E RESERVAS
  // ==========================================
  async insertAgendamento(agendamento: any, userId: number, typeAccess: string, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };

    // A área precisa existir e pertencer ao condomínio do operador — sem
    // isso, um usuário de outro condomínio reserva (ou vê conflitos de)
    // uma área alheia só chutando id_area_social.
    const areaAlvo = await this.prisma.areas_Sociais.findUnique({
      where: { id: Number(agendamento.id_area_social) },
    });
    if (!areaAlvo) throw new NotFoundException('Área social não encontrada');
    await this.tenant.assertEntidade(areaAlvo.id_condominio, user, 'área social');

    // Reserva feita pelo síndico/porteiro em nome de um morador (via web).
    // Neste caso a reserva deve pertencer ao morador do apartamento escolhido
    // (para aparecer em "minhas reservas" e disparar push para ele), e a
    // checagem de isolamento de morador não se aplica.
    const peloSindico = !!agendamento.agendarPeloSindico;
    // Sem essa checagem, qualquer morador mandava agendarPeloSindico:true e
    // auto-aprovava a própria reserva pulando a fila de autorização.
    if (peloSindico) assertOperador(user, 'agendar em nome de outro morador (auto-aprovação)');
    let donoReservaId = Number(userId);

    if (peloSindico) {
      // Resolve o morador vinculado ao apartamento; se não houver, mantém o
      // próprio operador como dono para que a reserva ainda seja registrada.
      const vinculo = await this.prisma.apartamentos_Users.findFirst({
        where: { id_apto: Number(agendamento.id_apartamento) },
        select: { id_user: true },
        orderBy: { id: 'asc' },
      });
      if (vinculo?.id_user) {
        donoReservaId = vinculo.id_user;
      }
    } else if (typeAccess === 'Morador') {
      // Validação de isolamento para moradores
      const aptosUser = await this.prisma.apartamentos_Users.findMany({
        where: { id_user: Number(userId) },
        select: { id_apto: true },
      });
      const idsPermitidos = aptosUser.map(a => a.id_apto);
      if (!idsPermitidos.includes(Number(agendamento.id_apartamento))) {
        throw new ForbiddenException('Você só pode agendar para o seu próprio apartamento.');
      }
    }

    // Converter string DD/MM/YYYY para Date
    const parts = agendamento.data.split('/');
    const dataObj = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));

    // Criar datas para hora_de e hora_ate
    const [hDe, mDe] = this.parseTime(agendamento.horaDe);
    const [hAte, mAte] = this.parseTime(agendamento.horaAte);

    const horaDeObj = new Date(1970, 0, 1, hDe, mDe, 0);
    const horaAteObj = new Date(1970, 0, 1, hAte, mAte, 0);

    // Buscar agendamentos do dia para comparar em memória, evitando problemas de timezone no banco
    const agendamentosDia = await this.prisma.areas_Sociais_Agendamentos.findMany({
      where: {
        id_area_social: Number(agendamento.id_area_social),
        data: dataObj,
        status: { in: ['pendente', 'aprovado'] },
      },
    });

    const requestedDe = hDe * 60 + mDe;
    const requestedAte = hAte * 60 + mAte;

    const conflito = agendamentosDia.find((a) => {
      if (!a.hora_de || !a.hora_ate) return false;
      const aDe = a.hora_de.getHours() * 60 + a.hora_de.getMinutes();
      const aAte = a.hora_ate.getHours() * 60 + a.hora_ate.getMinutes();
      return requestedDe < aAte && requestedAte > aDe;
    });

    if (conflito) {
      throw new BadRequestException('Este espaço já possui um agendamento ativo que conflita com o horário solicitado.');
    }

    // Recusa reserva que caia em manutenção — tirar da lista de horarios_livres
    // não basta porque a rota aceita POST direto, sem passar pela tela.
    const manutencoesDb = await this.prisma.areas_Sociais_Manutencoes.findMany({
      where: { id_area_social: Number(agendamento.id_area_social) },
    });
    // Mesma regra do get: manutenção sem data de início/término não bloqueia
    // nada (com o epoch, uma linha meia-boca recusava toda reserva da área).
    const janelasManutencao = manutencoesDb
      .filter(m => m.data_inicio != null && m.data_termino != null)
      .map(m => ({
        inicio: this.combineDateTime(m.data_inicio as Date, m.hora_inicio),
        fim: this.combineDateTime(m.data_termino as Date, m.hora_termino),
      }));
    const inicioBlocoSolicitado = this.combineDateTime(dataObj, horaDeObj);
    const fimBlocoSolicitado = this.combineDateTime(dataObj, horaAteObj);
    if (this.colideComJanela(inicioBlocoSolicitado, fimBlocoSolicitado, janelasManutencao)) {
      throw new BadRequestException('Esta área está em manutenção no horário solicitado.');
    }

    // Limite mensal por apartamento (null/0 = sem limite, comportamento de
    // sempre). Reserva feita pelo síndico não conta nem é bloqueada — é a
    // administração resolvendo, não o morador tentando monopolizar a área.
    // O mês é o da DATA SOLICITADA (não o de "agora"): reservar em janeiro
    // para março conta contra março. `dataObj` já foi montado a partir dos
    // componentes DD/MM/YYYY do próprio pedido, então ler ano/mês dele com
    // getFullYear()/getMonth() (sem passar por Intl/UTC) preserva o mesmo
    // calendário que o morador digitou — nada de decidir a virada de mês
    // pelo relógio do servidor.
    if (!peloSindico && areaAlvo.limite_mensal_apto && areaAlvo.limite_mensal_apto > 0) {
      const anoAlvo = dataObj.getFullYear();
      const mesAlvo = dataObj.getMonth();
      const primeiroDiaMes = new Date(anoAlvo, mesAlvo, 1);
      const primeiroDiaProxMes = new Date(anoAlvo, mesAlvo + 1, 1);

      const agendamentosNoMes = await this.prisma.areas_Sociais_Agendamentos.findMany({
        where: {
          id_area_social: Number(agendamento.id_area_social),
          id_apartamento: Number(agendamento.id_apartamento),
          status: { in: ['pendente', 'aprovado'] },
          data: { gte: primeiroDiaMes, lt: primeiroDiaProxMes },
        },
      });

      if (agendamentosNoMes.length >= areaAlvo.limite_mensal_apto) {
        const nomeMes = primeiroDiaMes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        throw new BadRequestException(
          `Este apartamento já atingiu o limite de ${areaAlvo.limite_mensal_apto} reserva(s) por mês nesta área em ${nomeMes}.`,
        );
      }
    }

    // Convidados é opcional (app antigo não manda o campo — null continua
    // válido e não é checado). Só quando um valor é de fato enviado é que
    // validamos: precisa ser inteiro positivo e, se a área tem capacidade
    // configurada (>0), não pode ultrapassá-la. Capacidade 0/nula = "não
    // configurada" — sem limite nenhum.
    let convidados: number | null = null;
    if (agendamento.convidados !== undefined && agendamento.convidados !== null && agendamento.convidados !== '') {
      const convidadosNum = Number(agendamento.convidados);
      if (!Number.isInteger(convidadosNum) || convidadosNum <= 0) {
        throw new BadRequestException('Número de convidados inválido.');
      }
      if (areaAlvo.capacidade && areaAlvo.capacidade > 0 && convidadosNum > areaAlvo.capacidade) {
        throw new BadRequestException(`Esta área comporta no máximo ${areaAlvo.capacidade} pessoas (incluindo os moradores).`);
      }
      convidados = convidadosNum;
    }

    // Definir status inicial baseado na regra da área.
    // Reserva criada pelo síndico/porteiro já entra aprovada (a própria
    // criação pela administração equivale à aprovação).
    const area = areaAlvo;

    const statusInicial = peloSindico
      ? 'aprovado'
      : area?.precisa_autorizacao === 1 ? 'pendente' : 'aprovado';

    const criado = await this.prisma.areas_Sociais_Agendamentos.create({
      data: {
        id_area_social: Number(agendamento.id_area_social),
        id_user: donoReservaId,
        id_apartamento: Number(agendamento.id_apartamento),
        data: dataObj,
        hora_de: horaDeObj,
        hora_ate: horaAteObj,
        status: statusInicial,
        convidados,
      },
    });

    // Já nasceu aprovada → enrola os moradores do apto no facial da área.
    if (statusInicial === 'aprovado') {
      this.facial
        .syncReservaArea(criado.id)
        .catch((err) => this.logger.warn(`syncReservaArea (insert) ag ${criado.id}: ${err?.message ?? err}`));
    }

    return { success: true, status: statusInicial };
  }

  async removeAgendamento(id: number, userId: number, typeAccess: string, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };

    const agTenantCheck = await this.prisma.areas_Sociais_Agendamentos.findUnique({
      where: { id: Number(id) },
      include: { area: { select: { id_condominio: true } } },
    });
    if (!agTenantCheck) throw new NotFoundException('Agendamento não encontrado.');
    await this.tenant.assertEntidade(agTenantCheck.area?.id_condominio, user, `agendamento #${id}`);

    if (typeAccess === 'Morador') {
      if (agTenantCheck.id_user !== Number(userId)) {
        throw new ForbiddenException('Você só pode remover seus próprios agendamentos.');
      }
    }

    // Cancelamento (dono ou síndico via remove): revoga o acesso facial ANTES
    // de apagar. É 'cancelado', não 'recusado' — recusa é decisão do síndico
    // via updateStatusAgendamento; aqui é a reserva sendo desfeita.
    const agAntes = await this.prisma.areas_Sociais_Agendamentos.findUnique({
      where: { id: Number(id) },
    });
    if (agAntes?.status === 'aprovado') {
      await this.prisma.areas_Sociais_Agendamentos.update({
        where: { id: Number(id) },
        data: { status: 'cancelado' },
      });
      await this.facial
        .syncReservaArea(Number(id))
        .catch((err) => this.logger.warn(`syncReservaArea (remove) ag ${id}: ${err?.message ?? err}`));
    }

    await this.prisma.areas_Sociais_Agendamentos.delete({
      where: { id: Number(id) },
    });

    return { success: true };
  }

  async getAllAgendamentos(idCondominio: number, user?: JwtPayload) {
    // Lista global de reservas do condomínio (fila de aprovação) — é
    // ferramenta de gestão, não deveria ser lida por um morador qualquer.
    assertOperador(user, 'ver todas as reservas do condomínio');
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) {
      return [
        {
          id: 1, nomeArea: 'Churrasqueira Gourmet', status: 'pendente', bloco: 'A', apto: '101',
          data_criacao: '14/05/2026 às 10:00', data: '20/05/2026', horaDe: '12:00', horaAte: '16:00',
        },
      ];
    }

    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);

    const list = await this.prisma.areas_Sociais_Agendamentos.findMany({
      where: {
        area: { id_condominio: Number(idCondominio) },
        data: { gt: ontem },
      },
      include: {
        area: { select: { nome: true } },
        apartamento: { select: { bloco: true, apto: true } },
      },
      orderBy: { data: 'desc' },
    });

    return list.map(ag => ({
      id: ag.id,
      nomeArea: ag.area?.nome ?? '',
      status: ag.status,
      bloco: ag.apartamento?.bloco ?? '',
      apto: ag.apartamento?.apto ?? '',
      data_criacao: ag.created_at.toLocaleDateString('pt-BR') + ' às ' + ag.created_at.toTimeString().substring(0, 5),
      data: ag.data ? ag.data.toLocaleDateString('pt-BR') : '',
      horaDe: ag.hora_de ? ag.hora_de.toTimeString().substring(0, 5) : '',
      horaAte: ag.hora_ate ? ag.hora_ate.toTimeString().substring(0, 5) : '',
      convidados: ag.convidados ?? null,
    }));
  }

  async getAllMeusAgendamentos(idCondominio: number, userId: number, idAptoQuery?: number, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) {
      return [
        {
          id: 1, nomeArea: 'Churrasqueira Gourmet', status: 'aprovado', bloco: 'A', apto: '101',
          data_criacao: '14/05/2026 às 10:00', data: '20/05/2026', horaDe: '12:00', horaAte: '16:00',
        },
      ];
    }

    // Buscar aptos do morador
    const aptosUser = await this.prisma.apartamentos_Users.findMany({
      where: { id_user: Number(userId) },
      select: { id_apto: true },
    });
    const permitidos = aptosUser.map(a => a.id_apto);

    let targetAptoId = idAptoQuery ? Number(idAptoQuery) : permitidos[0];
    if (idAptoQuery && !permitidos.includes(targetAptoId)) {
      throw new ForbiddenException('Acesso negado ao apartamento solicitado.');
    }

    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);

    const list = await this.prisma.areas_Sociais_Agendamentos.findMany({
      where: {
        area: { id_condominio: Number(idCondominio) },
        id_apartamento: targetAptoId ? targetAptoId : undefined,
        id_user: Number(userId),
        data: { gt: ontem },
      },
      include: {
        area: { select: { nome: true } },
        apartamento: { select: { bloco: true, apto: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return list.map(ag => ({
      id: ag.id,
      nomeArea: ag.area?.nome ?? '',
      status: ag.status,
      bloco: ag.apartamento?.bloco ?? '',
      apto: ag.apartamento?.apto ?? '',
      data_criacao: ag.created_at.toLocaleDateString('pt-BR') + ' às ' + ag.created_at.toTimeString().substring(0, 5),
      data: ag.data ? ag.data.toLocaleDateString('pt-BR') : '',
      horaDe: ag.hora_de ? ag.hora_de.toTimeString().substring(0, 5) : '',
      horaAte: ag.hora_ate ? ag.hora_ate.toTimeString().substring(0, 5) : '',
      convidados: ag.convidados ?? null,
    }));
  }

  async updateStatusAgendamento(id: number, statusRaw: string | boolean, motivo?: string, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };

    assertOperador(user, 'aprovar ou recusar reserva');
    const agAlvo = await this.prisma.areas_Sociais_Agendamentos.findUnique({
      where: { id: Number(id) },
      include: { area: { select: { id_condominio: true } } },
    });
    if (!agAlvo) throw new NotFoundException('Agendamento não encontrado.');
    await this.tenant.assertEntidade(agAlvo.area?.id_condominio, user, `agendamento #${id}`);

    let novoStatus = 'pendente';
    if (typeof statusRaw === 'boolean') {
      novoStatus = statusRaw ? 'aprovado' : 'recusado';
    } else {
      novoStatus = statusRaw;
    }

    const agendamento = await this.prisma.areas_Sociais_Agendamentos.update({
      where: { id: Number(id) },
      data: {
        status: novoStatus,
        // se houver coluna de motivo gravamos, senão ignoramos graciosamente
      },
      include: {
        user: true,
        area: true,
      },
    });

    // Check-in por facial: aprovado enrola os moradores do apto no terminal da
    // área (janela do horário); recusado remove. Fire-and-forget.
    this.facial
      .syncReservaArea(Number(id))
      .catch((err) =>
        this.logger.warn(`syncReservaArea (status) ag ${id}: ${err?.message ?? err}`),
      );

    // Send push notification if the user has an fcm_token
    if (agendamento && agendamento.user && agendamento.user.fcm_token) {
      const token = agendamento.user.fcm_token;
      const areaNome = agendamento.area?.nome ?? 'Área Social';
      
      let title = 'Status da Reserva Atualizado';
      let body = `O status da sua reserva para ${areaNome} mudou para ${novoStatus}.`;
      
      if (novoStatus === 'aprovado') {
        title = 'Reserva Aprovada! 📅';
        body = `Sua reserva para a área ${areaNome} foi aprovada.`;
      } else if (novoStatus === 'recusado') {
        title = 'Reserva Recusada! ❌';
        body = `Sua reserva para a área ${areaNome} foi recusada.`;
        if (motivo) {
          body += ` Motivo: ${motivo}`;
        }
      }

      try {
        await this.notifications.sendPushNotification(token, title, body, {
          type: 'reserva_status',
          id: String(agendamento.id),
          status: novoStatus,
        });
      } catch (err) {
        console.error('Erro ao enviar push notification para agendamento:', err);
      }
    }

    return { success: true };
  }

  // ==========================================
  // MANUTENÇÕES
  // ==========================================

  /**
   * Reservas 'pendente'/'aprovado' da área que colidem com a janela de uma
   * manutenção nova ou editada. Usa os mesmos `combineDateTime`/`colideComJanela`
   * do resto do arquivo — nada de reimplementar a checagem de sobreposição.
   * Traz `apartamento` (pro relatório de conflito) e `user` (pro push depois).
   */
  private async detectarAgendamentosAtingidos(idAreaSocial: number, inicio: Date, fim: Date) {
    const candidatos = await this.prisma.areas_Sociais_Agendamentos.findMany({
      where: {
        id_area_social: Number(idAreaSocial),
        status: { in: ['pendente', 'aprovado'] },
      },
      include: {
        apartamento: { select: { bloco: true, apto: true } },
        user: { select: { fcm_token: true } },
      },
    });

    return candidatos.filter((ag) => {
      if (!ag.data) return false;
      const agInicio = this.combineDateTime(ag.data, ag.hora_de);
      const agFim = this.combineDateTime(ag.data, ag.hora_ate);
      return this.colideComJanela(agInicio, agFim, [{ inicio, fim }]);
    });
  }

  // Formato do relatório de conflito exigido pelo front (409) — snake_case
  // porque é isso que a tela de manutenção espera renderizar na lista.
  private formatarConflito(ag: any) {
    return {
      id: ag.id,
      data: ag.data ? ag.data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
      hora_de: ag.hora_de ? ag.hora_de.toTimeString().substring(0, 5) : '',
      hora_ate: ag.hora_ate ? ag.hora_ate.toTimeString().substring(0, 5) : '',
      bloco: ag.apartamento?.bloco ?? '',
      apto: ag.apartamento?.apto ?? '',
    };
  }

  // Marca cada reserva atingida como 'cancelado' dentro da MESMA transação
  // que grava a manutenção — ver `insertManutencao`/`updateManutencao`. `tx`
  // é o client transacional do Prisma (interactive transaction), nunca
  // `this.prisma` direto: se a 3ª de 5 atualizações falhar (queda de conexão,
  // por exemplo), o rollback tem que desfazer TUDO — manutenção incluída —
  // em vez de deixar 2 reservas canceladas e 3 "aprovadas" dentro da janela
  // de manutenção (a inconsistência que esta task existe para fechar) e, no
  // insert, uma manutenção órfã que uma nova tentativa duplicaria.
  private async cancelarStatusEmTransacao(tx: PrismaTx, conflitantes: any[]) {
    for (const ag of conflitantes) {
      await tx.areas_Sociais_Agendamentos.update({
        where: { id: ag.id },
        data: { status: 'cancelado' },
      });
    }
  }

  /**
   * Efeitos colaterais EXTERNOS do cancelamento por manutenção — revoga o
   * facial e avisa o dono por push. De propósito FORA da transação: são
   * chamadas de rede best-effort (mesmo padrão de `updateStatusAgendamento`)
   * que não podem fazer um rollback de banco por causa de push fora do ar.
   * Só roda depois que a transação de escrita já confirmou.
   */
  private async notificarCancelamentosPorManutencao(conflitantes: any[], nomeArea: string) {
    for (const ag of conflitantes) {
      this.facial
        .syncReservaArea(Number(ag.id))
        .catch((err) => this.logger.warn(`syncReservaArea (manutenção) ag ${ag.id}: ${err?.message ?? err}`));

      const token = ag.user?.fcm_token;
      if (token) {
        const dataStr = ag.data
          ? ag.data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : '';
        const horaDeStr = ag.hora_de ? ag.hora_de.toTimeString().substring(0, 5) : '';
        const horaAteStr = ag.hora_ate ? ag.hora_ate.toTimeString().substring(0, 5) : '';
        try {
          await this.notifications.sendPushNotification(
            token,
            'Reserva cancelada',
            `Sua reserva para ${nomeArea} em ${dataStr} (${horaDeStr}-${horaAteStr}) foi cancelada: a área entrará em manutenção nesse período.`,
            { type: 'reserva_cancelada_manutencao', id: String(ag.id) },
          );
        } catch (err) {
          this.logger.warn(`push cancelamento por manutenção ag ${ag.id}: ${(err as Error)?.message ?? err}`);
        }
      }
    }
  }

  async insertManutencao(manutencao: any, user?: JwtPayload) {
    assertOperador(user, 'agendar manutenção');
    if (!this.prisma.isConnected) return { success: true };

    const area = await this.prisma.areas_Sociais.findUnique({
      where: { id: Number(manutencao.id_area_social) },
    });
    if (!area) throw new NotFoundException('Área social não encontrada');
    await this.tenant.assertEntidade(area.id_condominio, user, 'área social');

    // Converter datas
    const pIni = manutencao.data_inicio.split('/');
    const dIni = new Date(Number(pIni[2]), Number(pIni[1]) - 1, Number(pIni[0]));

    const pFim = manutencao.data_termino.split('/');
    const dFim = new Date(Number(pFim[2]), Number(pFim[1]) - 1, Number(pFim[0]));

    const [hI, mI] = this.parseTime(manutencao.hora_inicio);
    const [hF, mF] = this.parseTime(manutencao.hora_termino);
    const horaInicioObj = new Date(1970, 0, 1, hI, mI, 0);
    const horaTerminoObj = new Date(1970, 0, 1, hF, mF, 0);

    // Reservas já existentes que caem na janela nova — sem isso a manutenção
    // entrava "por cima" de reservas ativas: morador nunca era avisado e, em
    // área com facial, a catraca continuava abrindo pra ele.
    const inicioJanela = this.combineDateTime(dIni, horaInicioObj);
    const fimJanela = this.combineDateTime(dFim, horaTerminoObj);
    const conflitantes = await this.detectarAgendamentosAtingidos(Number(manutencao.id_area_social), inicioJanela, fimJanela);

    if (conflitantes.length > 0 && manutencao.confirmar_cancelamentos !== true) {
      // Nada é gravado sem confirmação explícita — matar silenciosamente as
      // reservas de outras famílias é pior do que pedir mais um clique.
      throw new ConflictException({
        conflitos: conflitantes.map((ag) => this.formatarConflito(ag)),
        total: conflitantes.length,
      });
    }

    // Manutenção nova + cancelamento das reservas atingidas precisam confirmar
    // juntos ou nenhum dos dois: sem transação, uma falha no meio dos updates
    // deixava a manutenção gravada com só parte das reservas canceladas — e,
    // pior, reexecutar o insert criaria uma SEGUNDA linha de manutenção.
    await this.prisma.$transaction(async (tx) => {
      await tx.areas_Sociais_Manutencoes.create({
        data: {
          id_area_social: Number(manutencao.id_area_social),
          descricao: manutencao.descricao,
          data_inicio: dIni,
          hora_inicio: horaInicioObj,
          data_termino: dFim,
          hora_termino: horaTerminoObj,
        },
      });

      if (conflitantes.length > 0) {
        await this.cancelarStatusEmTransacao(tx, conflitantes);
      }
    });

    // Facial + push são efeitos externos best-effort — de propósito depois
    // da transação já confirmada (ver `notificarCancelamentosPorManutencao`).
    if (conflitantes.length > 0) {
      await this.notificarCancelamentosPorManutencao(conflitantes, area.nome);
    }

    return { success: true };
  }

  async updateManutencao(manutencao: any, user?: JwtPayload) {
    assertOperador(user, 'editar manutenção');
    if (!this.prisma.isConnected) return { success: true };

    const atual = await this.prisma.areas_Sociais_Manutencoes.findUnique({
      where: { id: Number(manutencao.id) },
      include: { area: { select: { id_condominio: true, nome: true } } },
    });
    if (!atual) throw new NotFoundException('Manutenção não encontrada.');
    await this.tenant.assertEntidade(atual.area?.id_condominio, user, `manutenção #${manutencao.id}`);

    const pIni = manutencao.data_inicio.split('/');
    const dIni = new Date(Number(pIni[2]), Number(pIni[1]) - 1, Number(pIni[0]));

    const pFim = manutencao.data_termino.split('/');
    const dFim = new Date(Number(pFim[2]), Number(pFim[1]) - 1, Number(pFim[0]));

    const [hI, mI] = this.parseTime(manutencao.hora_inicio);
    const [hF, mF] = this.parseTime(manutencao.hora_termino);
    const horaInicioObj = new Date(1970, 0, 1, hI, mI, 0);
    const horaTerminoObj = new Date(1970, 0, 1, hF, mF, 0);

    const inicioJanela = this.combineDateTime(dIni, horaInicioObj);
    const fimJanela = this.combineDateTime(dFim, horaTerminoObj);
    const conflitantes = await this.detectarAgendamentosAtingidos(atual.id_area_social, inicioJanela, fimJanela);

    if (conflitantes.length > 0 && manutencao.confirmar_cancelamentos !== true) {
      throw new ConflictException({
        conflitos: conflitantes.map((ag) => this.formatarConflito(ag)),
        total: conflitantes.length,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.areas_Sociais_Manutencoes.update({
        where: { id: Number(manutencao.id) },
        data: {
          descricao: manutencao.descricao,
          data_inicio: dIni,
          hora_inicio: horaInicioObj,
          data_termino: dFim,
          hora_termino: horaTerminoObj,
        },
      });

      if (conflitantes.length > 0) {
        await this.cancelarStatusEmTransacao(tx, conflitantes);
      }
    });

    if (conflitantes.length > 0) {
      await this.notificarCancelamentosPorManutencao(conflitantes, atual.area?.nome ?? 'Área Social');
    }

    return { success: true };
  }

  async removeManutencao(id: number, user?: JwtPayload) {
    assertOperador(user, 'remover manutenção');
    if (!this.prisma.isConnected) return { success: true };
    const atual = await this.prisma.areas_Sociais_Manutencoes.findUnique({
      where: { id: Number(id) },
      include: { area: { select: { id_condominio: true } } },
    });
    if (!atual) throw new NotFoundException('Manutenção não encontrada.');
    await this.tenant.assertEntidade(atual.area?.id_condominio, user, `manutenção #${id}`);
    await this.prisma.areas_Sociais_Manutencoes.delete({ where: { id: Number(id) } });
    return { success: true };
  }
}

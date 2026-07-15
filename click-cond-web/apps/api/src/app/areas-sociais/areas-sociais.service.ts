import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../common/storage/storage.service';

const DEFAULT_AREA_IMAGE = 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600';

@Injectable()
export class AreasSociaisService {
  private readonly logger = new Logger(AreasSociaisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  private parseTime(timeStr: string | null | undefined): [number, number] {
    const s = String(timeStr ?? '00:00').trim();
    const match = s.match(/(\d{2}):(\d{2})/);
    if (match) {
      return [Number(match[1]), Number(match[2])];
    }
    return [0, 0];
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
  async insert(idCondominio: number, areaSocial: any) {
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
        id_condominio: Number(idCondominio),
      },
    });

    return { success: true };
  }

  async update(idCondominio: number, areaSocial: any) {
    if (!this.prisma.isConnected) {
      return { success: true };
    }

    const imagemUrl = await this.resolveImagem(areaSocial.imagem);

    const horariosStr = typeof areaSocial.horarios === 'string'
      ? areaSocial.horarios
      : JSON.stringify(areaSocial.horarios ?? []);

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
      },
    });

    return { success: true };
  }

  async remove(id: number) {
    if (!this.prisma.isConnected) return { success: true };
    await this.prisma.areas_Sociais.delete({ where: { id: Number(id) } });
    return { success: true };
  }

  async getAll(idCondominio: number) {
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
        precisa_agendar: true,
        precisa_autorizacao: true,
        precisa_pagamento: true,
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

  async get(idCondominio: number, idArea: number) {
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
      };
    }

    const area = await this.prisma.areas_Sociais.findUnique({
      where: { id: Number(idArea) },
    });

    if (!area) throw new NotFoundException('Área social não encontrada');

    let horariosObj: any[] = [];
    try {
      horariosObj = area.horarios ? JSON.parse(area.horarios) : [];
    } catch {
      horariosObj = [];
    }

    // Buscar agendamentos futuros (data > ontem)
    const ontem = new Date();
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
      };
    });

    // Calcular horários livres para 60 dias
    const horariosLivres: Record<string, any[]> = {};
    const currDate = new Date();

    for (let i = 0; i < 60; i++) {
      currDate.setDate(currDate.getDate() + 1);
      const dataFormatada = currDate.toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
      // Lógica de dia da semana do legado (Segunda = 0, Domingo = 6)
      const dayRaw = currDate.getDay();
      const weekDay = dayRaw - 1 < 0 ? 6 : dayRaw - 1;

      if (horariosObj[weekDay] && Array.isArray(horariosObj[weekDay].horarios)) {
        if (horariosObj[weekDay].horarios.length > 0) {
          horariosLivres[dataFormatada] = JSON.parse(JSON.stringify(horariosObj[weekDay].horarios));
        }
      }
    }

    // Remover horários já ocupados
    // Invertemos para remover com segurança, ou filtramos
    agendamentos.forEach(ag => {
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
      id_condominio: area.id_condominio,
      tem_monitoramento: temMonitoramento,
      ocupacao: temMonitoramento ? (ocupacaoMap.get(area.id) ?? 0) : 0,
      horarios: horariosObj,
      agendamentos,
      horarios_livres: horariosLivres,
    };
  }

  // ==========================================
  // AGENDAMENTOS E RESERVAS
  // ==========================================
  async insertAgendamento(agendamento: any, userId: number, typeAccess: string) {
    if (!this.prisma.isConnected) return { success: true };

    // Reserva feita pelo síndico/porteiro em nome de um morador (via web).
    // Neste caso a reserva deve pertencer ao morador do apartamento escolhido
    // (para aparecer em "minhas reservas" e disparar push para ele), e a
    // checagem de isolamento de morador não se aplica.
    const peloSindico = !!agendamento.agendarPeloSindico;
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

    // Definir status inicial baseado na regra da área.
    // Reserva criada pelo síndico/porteiro já entra aprovada (a própria
    // criação pela administração equivale à aprovação).
    const area = await this.prisma.areas_Sociais.findUnique({
      where: { id: Number(agendamento.id_area_social) },
    });

    const statusInicial = peloSindico
      ? 'aprovado'
      : area?.precisa_autorizacao === 1 ? 'pendente' : 'aprovado';

    await this.prisma.areas_Sociais_Agendamentos.create({
      data: {
        id_area_social: Number(agendamento.id_area_social),
        id_user: donoReservaId,
        id_apartamento: Number(agendamento.id_apartamento),
        data: dataObj,
        hora_de: horaDeObj,
        hora_ate: horaAteObj,
        status: statusInicial,
      },
    });

    return { success: true, status: statusInicial };
  }

  async removeAgendamento(id: number, userId: number, typeAccess: string) {
    if (!this.prisma.isConnected) return { success: true };

    if (typeAccess === 'Morador') {
      const ag = await this.prisma.areas_Sociais_Agendamentos.findUnique({
        where: { id: Number(id) },
      });
      if (!ag || ag.id_user !== Number(userId)) {
        throw new ForbiddenException('Você só pode remover seus próprios agendamentos.');
      }
    }

    await this.prisma.areas_Sociais_Agendamentos.delete({
      where: { id: Number(id) },
    });

    return { success: true };
  }

  async getAllAgendamentos(idCondominio: number) {
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
    }));
  }

  async getAllMeusAgendamentos(idCondominio: number, userId: number, idAptoQuery?: number) {
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
    }));
  }

  async updateStatusAgendamento(id: number, statusRaw: string | boolean, motivo?: string) {
    if (!this.prisma.isConnected) return { success: true };

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
  async insertManutencao(manutencao: any) {
    if (!this.prisma.isConnected) return { success: true };

    // Converter datas
    const pIni = manutencao.data_inicio.split('/');
    const dIni = new Date(Number(pIni[2]), Number(pIni[1]) - 1, Number(pIni[0]));

    const pFim = manutencao.data_termino.split('/');
    const dFim = new Date(Number(pFim[2]), Number(pFim[1]) - 1, Number(pFim[0]));

    const [hI, mI] = this.parseTime(manutencao.hora_inicio);
    const [hF, mF] = this.parseTime(manutencao.hora_termino);

    await this.prisma.areas_Sociais_Manutencoes.create({
      data: {
        id_area_social: Number(manutencao.id_area_social),
        descricao: manutencao.descricao,
        data_inicio: dIni,
        hora_inicio: new Date(1970, 0, 1, hI, mI, 0),
        data_termino: dFim,
        hora_termino: new Date(1970, 0, 1, hF, mF, 0),
      },
    });

    return { success: true };
  }

  async updateManutencao(manutencao: any) {
    if (!this.prisma.isConnected) return { success: true };

    const pIni = manutencao.data_inicio.split('/');
    const dIni = new Date(Number(pIni[2]), Number(pIni[1]) - 1, Number(pIni[0]));

    const pFim = manutencao.data_termino.split('/');
    const dFim = new Date(Number(pFim[2]), Number(pFim[1]) - 1, Number(pFim[0]));

    const [hI, mI] = this.parseTime(manutencao.hora_inicio);
    const [hF, mF] = this.parseTime(manutencao.hora_termino);

    await this.prisma.areas_Sociais_Manutencoes.update({
      where: { id: Number(manutencao.id) },
      data: {
        descricao: manutencao.descricao,
        data_inicio: dIni,
        hora_inicio: new Date(1970, 0, 1, hI, mI, 0),
        data_termino: dFim,
        hora_termino: new Date(1970, 0, 1, hF, mF, 0),
      },
    });

    return { success: true };
  }

  async removeManutencao(id: number) {
    if (!this.prisma.isConnected) return { success: true };
    await this.prisma.areas_Sociais_Manutencoes.delete({ where: { id: Number(id) } });
    return { success: true };
  }
}

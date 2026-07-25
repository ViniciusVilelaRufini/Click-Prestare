import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { assertStaff } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Manutenções programadas do condomínio (tabela Agenda).
 *
 * É a tela "Manutenções Programadas" do app (ListAgenda). Leitura liberada
 * para qualquer morador do condomínio; escrita só para síndico/funcionário,
 * mesmo recorte que as rotas Express originais.
 */
@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantAccessService,
  ) {}

  async findAll(idCondominio: number, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    const list = await this.prisma.agenda.findMany({
      where: { id_condominio: Number(idCondominio) },
      include: { criadoPor: { select: { name: true } } },
      orderBy: [{ data_inicio: 'desc' }, { created_at: 'desc' }],
    });
    return list.map((a) => this.flatten(a));
  }

  async findOne(id: number, user?: JwtPayload) {
    const a = await this.prisma.agenda.findUnique({
      where: { id: Number(id) },
      include: { criadoPor: { select: { name: true } } },
    });
    if (!a) throw new NotFoundException(`Manutenção ${id} não encontrada`);
    await this.tenant.assertEntidade(a.id_condominio, user, `manutenção #${id}`);
    return this.flatten(a);
  }

  async create(idCondominio: number, agenda: any, user?: JwtPayload) {
    assertStaff(user, 'cadastrar manutenção programada');
    await this.tenant.assertCondominio(idCondominio, user);

    const titulo = String(agenda?.titulo ?? '').trim();
    if (!titulo) throw new BadRequestException('O título é obrigatório.');

    const idUser = user?.user?.id ?? user?.sub;
    return this.prisma.agenda.create({
      data: {
        titulo,
        descricao: agenda?.descricao ?? null,
        data_inicio: this.parseData(agenda?.data_inicio),
        data_termino: this.parseData(agenda?.data_termino),
        hora_inicio: this.parseHora(agenda?.hora_inicio),
        hora_termino: this.parseHora(agenda?.hora_termino),
        alertar_moradores: this.parseAlertar(agenda),
        id_condominio: Number(idCondominio),
        user: idUser ? Number(idUser) : null,
      },
    });
  }

  async update(idCondominio: number, agenda: any, user?: JwtPayload) {
    assertStaff(user, 'editar manutenção programada');
    const id = Number(agenda?.id);
    if (!id || Number.isNaN(id)) {
      throw new BadRequestException('ID da manutenção é obrigatório para edição.');
    }

    const atual = await this.prisma.agenda.findUnique({
      where: { id },
      select: { id_condominio: true },
    });
    if (!atual) throw new NotFoundException(`Manutenção ${id} não encontrada`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `manutenção #${id}`);

    return this.prisma.agenda.update({
      where: { id },
      data: {
        ...(agenda.titulo !== undefined && { titulo: String(agenda.titulo).trim() }),
        ...(agenda.descricao !== undefined && { descricao: agenda.descricao ?? null }),
        ...(agenda.data_inicio !== undefined && { data_inicio: this.parseData(agenda.data_inicio) }),
        ...(agenda.data_termino !== undefined && { data_termino: this.parseData(agenda.data_termino) }),
        ...(agenda.hora_inicio !== undefined && { hora_inicio: this.parseHora(agenda.hora_inicio) }),
        ...(agenda.hora_termino !== undefined && { hora_termino: this.parseHora(agenda.hora_termino) }),
        alertar_moradores: this.parseAlertar(agenda),
      },
    });
  }

  async remove(id: number, user?: JwtPayload) {
    assertStaff(user, 'remover manutenção programada');
    const atual = await this.prisma.agenda.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true },
    });
    if (!atual) throw new NotFoundException(`Manutenção ${id} não encontrada`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `manutenção #${id}`);
    await this.prisma.agenda.delete({ where: { id: Number(id) } });
    return { ok: true };
  }

  /**
   * O app manda a data já serializada pelo Dart:
   * `DateTime.toString()` → "2026-07-25 00:00:00.000". Também aceita ISO e
   * "dd/MM/yyyy" para não quebrar com chamadas antigas/manuais.
   *
   * Monta em UTC de propósito: a coluna é @db.Date e converter em horário
   * local jogaria o dia para trás em fuso negativo (BRT = UTC-3).
   */
  private parseData(raw: unknown): Date | null {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (!s) return null;

    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) {
      return new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1])));
    }

    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    }

    return null;
  }

  /**
   * Hora vinda do app: "1970-01-01 14:30:00.000" (DateTime.toString() do Dart).
   * Aceita também "HH:mm" puro. A coluna é @db.Time, então só as horas/minutos
   * importam — fixa a data em 1970-01-01 UTC.
   */
  private parseHora(raw: unknown): Date | null {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (!s) return null;

    const m = s.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return new Date(Date.UTC(1970, 0, 1, h, min));
  }

  /** O app manda `alertar` (bool); o banco guarda `alertar_moradores` (tinyint). */
  private parseAlertar(agenda: any): number {
    const raw = agenda?.alertar ?? agenda?.alertar_moradores;
    return raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0;
  }

  /**
   * Devolve datas/horas como string no formato que os campos do app esperam
   * (dd/MM/yyyy e HH:mm), igual ao que MudancasService já faz.
   */
  private flatten(a: any) {
    const { criadoPor, ...rest } = a;
    return {
      ...rest,
      data_inicio: a.data_inicio
        ? new Date(a.data_inicio).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
        : null,
      data_termino: a.data_termino
        ? new Date(a.data_termino).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
        : null,
      hora_inicio: a.hora_inicio
        ? new Date(a.hora_inicio).toISOString().substring(11, 16)
        : null,
      hora_termino: a.hora_termino
        ? new Date(a.hora_termino).toISOString().substring(11, 16)
        : null,
      alertar_moradores: a.alertar_moradores === 1,
      alertar: a.alertar_moradores === 1,
      criado_por: criadoPor?.name ?? null,
    };
  }
}

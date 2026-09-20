import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { CriarVisitaDto } from './dto/criar-visita.dto';

@Injectable()
export class VisitasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pessoasService: PessoasService,
  ) {}

  async criarVisita(dto: CriarVisitaDto) {
    const pessoa = await this.pessoasService.obterOuCriar(Number(dto.id_condominio), dto.pessoa);

    const inicio = dto.data_hora_inicio ? new Date(dto.data_hora_inicio) : null;
    const termino = dto.data_hora_termino ? new Date(dto.data_hora_termino) : null;

    return this.prisma.visitas.create({
      data: {
        id_pessoa: pessoa.id,
        id_condominio: Number(dto.id_condominio),
        id_apartamento: Number(dto.id_apartamento),
        user: dto.user ? Number(dto.user) : null,
        is_visitante: dto.is_visitante ?? 1,
        is_prestador: dto.is_prestador ?? 0,
        data_hora_inicio: inicio,
        data_hora_termino: termino,
        codigo_acesso: dto.codigo_acesso ?? null,
        liberado: dto.liberado ?? 1,
        avisar: dto.avisar ?? 1,
        tag_rfid: dto.tag_rfid ?? null,
        dias_semana: dto.dias_semana ?? null,
        categorias: dto.categorias ?? null,
        auth_status: dto.auth_status ?? null,
      },
      include: {
        pessoa: true,
        apartamento: true,
      },
    });
  }

  /**
   * Confere que a Visita existe e pertence ao condomínio da rota antes de
   * escrever nela.
   *
   * Duas falhas cobertas de uma vez:
   *  - Sem checar existência, um `id` inexistente deixava o P2025 do Prisma
   *    escapar cru do `update` e virar 500 — em vez do 404 que o controller
   *    já sabe tratar.
   *  - Sem checar `id_condominio`, `idVisita` é um id global (não escopado
   *    por condomínio na URL) — um operador do condomínio A conseguia
   *    registrar entrada/saída na visita do condomínio B só chutando o id
   *    (IDOR cross-tenant). `idCondominio` vem do `:idCondominio` da rota,
   *    que o TenantGuard já validou pertencer ao usuário autenticado.
   */
  private async assertVisitaDoCondominio(idVisita: number, idCondominio: number): Promise<void> {
    const existente = await this.prisma.visitas.findUnique({
      where: { id: Number(idVisita) },
      select: { id: true, id_condominio: true },
    });
    if (!existente) {
      throw new NotFoundException(`Visita ${idVisita} não encontrada`);
    }
    if (existente.id_condominio !== Number(idCondominio)) {
      throw new ForbiddenException('Acesso negado: esta visita pertence a outro condomínio.');
    }
  }

  async registrarEntrada(idVisita: number, idCondominio: number) {
    await this.assertVisitaDoCondominio(idVisita, idCondominio);
    return this.prisma.visitas.update({
      where: { id: Number(idVisita) },
      data: { data_entrada: new Date() },
      include: { pessoa: true, apartamento: true },
    });
  }

  async registrarSaida(idVisita: number, idCondominio: number) {
    await this.assertVisitaDoCondominio(idVisita, idCondominio);
    const visita = await this.prisma.visitas.update({
      where: { id: Number(idVisita) },
      data: { data_saida: new Date() },
      include: { pessoa: true, apartamento: true },
    });

    if (this.prisma.vagas) {
      await this.prisma.vagas.updateMany({
        where: { id_visita: Number(idVisita) },
        data: { ativo: 0 },
      });
    }

    return visita;
  }

  async listarPresenca(idCondominio: number) {
    return this.prisma.visitas.findMany({
      where: {
        id_condominio: Number(idCondominio),
        data_entrada: { not: null },
        data_saida: null,
      },
      include: {
        pessoa: true,
        apartamento: true,
      },
      orderBy: { data_entrada: 'desc' },
    });
  }

  async buscarPorPin(idCondominio: number, pin: string) {
    return this.prisma.visitas.findFirst({
      where: {
        id_condominio: Number(idCondominio),
        codigo_acesso: pin,
        liberado: 1,
        bloqueado: 0,
      },
      include: {
        pessoa: true,
        apartamento: true,
      },
    });
  }

  async listarVisitasCondominio(idCondominio: number, limit = 50) {
    return this.prisma.visitas.findMany({
      where: { id_condominio: Number(idCondominio) },
      include: {
        pessoa: true,
        apartamento: true,
      },
      orderBy: [{ data_hora_inicio: 'desc' }, { created_at: 'desc' }],
      take: limit,
    });
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { validarPlaca } from '../common/placa.util';

export interface VeiculoDto {
  placa: string;
  cor?: string | null;
  marca_modelo?: string | null;
  id_tag?: number | null;
}

@Injectable()
export class VeiculosService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizar(dto: VeiculoDto) {
    return {
      placa: (dto.placa || '').toUpperCase().trim(),
      cor: dto.cor?.trim() || null,
      marca_modelo: dto.marca_modelo?.trim() || null,
      id_tag: dto.id_tag ?? null,
    };
  }

  async findByMorador(idCondominio: number, idMorador: number) {
    return this.prisma.veiculos.findMany({
      where: { id_condominio: idCondominio, id_morador: idMorador, ativo: 1 },
      include: { tag: true },
      orderBy: { created_at: 'desc' },
    });
  }

  /** Todos os veículos ativos do condomínio, com dados do morador titular — para a tela da portaria. */
  async findAll(idCondominio: number) {
    return this.prisma.veiculos.findMany({
      where: { id_condominio: idCondominio, ativo: 1 },
      include: {
        tag: true,
        morador: { select: { id: true, nome: true, bloco: true, apartamento: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * `id_tag` vem do corpo e `Veiculos.id_tag` referencia Tags só por id: sem
   * esta checagem o operador anexava a tag de outro condomínio — e a resposta
   * (`include: { tag: true }`) devolvia o `codigo` RFID dela.
   */
  private async assertTagDoCondominio(idCondominio: number, idTag: number | null): Promise<void> {
    if (idTag == null) return;
    const tag = await this.prisma.tags.findFirst({
      where: { id: Number(idTag), id_condominio: idCondominio },
      select: { id: true },
    });
    if (!tag) throw new BadRequestException('Tag inválida para este condomínio.');
  }

  /**
   * Uma tag, um veículo ativo — mesma regra (e mensagem) do app do morador
   * (`vincularTagAoVeiculo`). Sem isto a portaria ligava a mesma tag a dois
   * carros e a leitura não tinha como dizer de quem era a passagem.
   */
  private async assertTagLivre(idTag: number | null, idVeiculo: number | null): Promise<void> {
    if (idTag == null) return;
    const emOutro = await this.prisma.veiculos.findFirst({
      where: {
        id_tag: Number(idTag),
        ativo: 1,
        ...(idVeiculo != null ? { id: { not: idVeiculo } } : {}),
      },
      select: { id: true },
    });
    if (emOutro) {
      throw new BadRequestException('Esta tag já está vinculada a outro veículo.');
    }
  }

  async create(idCondominio: number, idMorador: number, dto: VeiculoDto) {
    const data = this.normalizar(dto);
    data.placa = validarPlaca(data.placa);
    // O morador vem da URL e o TenantGuard só amarra o :idCondominio: confere
    // que ele é deste condomínio, senão o veículo aparecia no app (e na cota
    // de vagas) de um morador de outro prédio.
    const morador = await this.prisma.moradores.findFirst({
      where: { id: Number(idMorador), id_condominio: idCondominio },
      select: { id: true },
    });
    if (!morador) throw new NotFoundException(`Morador ${idMorador} não encontrado`);
    await this.assertTagDoCondominio(idCondominio, data.id_tag);
    await this.assertTagLivre(data.id_tag, null);
    try {
      return await this.prisma.veiculos.create({
        data: { ...data, id_condominio: idCondominio, id_morador: idMorador },
        include: { tag: true },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestException('Já existe um veículo com essa placa neste condomínio.');
      }
      throw err;
    }
  }

  async update(idCondominio: number, id: number, dto: VeiculoDto) {
    const existing = await this.prisma.veiculos.findFirst({
      where: { id: Number(id), id_condominio: idCondominio },
    });
    if (!existing) throw new NotFoundException(`Veículo ${id} não encontrado`);
    const data = this.normalizar(dto);
    data.placa = validarPlaca(data.placa);
    await this.assertTagDoCondominio(idCondominio, data.id_tag);
    // A tela reenvia o formulário inteiro: se o veículo já tem esta tag e ela
    // não mudou, não há o que conferir — dado antigo (a mesma tag em dois
    // veículos) não pode travar a edição dos outros campos.
    if (data.id_tag == null || Number(data.id_tag) !== existing.id_tag) {
      await this.assertTagLivre(data.id_tag, Number(id));
    }
    try {
      return await this.prisma.veiculos.update({
        where: { id: Number(id) },
        data,
        include: { tag: true },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestException('Já existe um veículo com essa placa neste condomínio.');
      }
      throw err;
    }
  }

  async remove(idCondominio: number, id: number) {
    const existing = await this.prisma.veiculos.findFirst({
      where: { id: Number(id), id_condominio: idCondominio },
    });
    if (!existing) throw new NotFoundException(`Veículo ${id} não encontrado`);
    await this.prisma.veiculos.delete({ where: { id: Number(id) } });
    return { ok: true };
  }
}

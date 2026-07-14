import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

  async create(idCondominio: number, idMorador: number, dto: VeiculoDto) {
    const data = this.normalizar(dto);
    if (!data.placa) throw new BadRequestException('Placa é obrigatória.');
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
    if (!data.placa) throw new BadRequestException('Placa é obrigatória.');
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

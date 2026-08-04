import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { assertStaff } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';

export interface ContatoDto {
  id?: number | string;
  nome?: string;
  categoria?: string;
  telefone?: string;
  observacao?: string | null;
}

/**
 * Contatos úteis do condomínio — a agenda de mão de obra (eletricista,
 * encanador, chaveiro) que o síndico mantém e o morador só consulta.
 *
 * Segue o mesmo contrato de autorização de Documentos, de propósito: escrita é
 * staff (`assertStaff`), leitura é qualquer pessoa do condomínio
 * (`tenant.assertCondominio`) — é exatamente a relação "síndico publica,
 * morador consulta" que o usuário pediu, e a mesma que já vale para as atas.
 */
@Injectable()
export class ContatosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantAccessService,
  ) {}

  private normalizar(dto: ContatoDto) {
    const nome = (dto.nome ?? '').trim();
    const categoria = (dto.categoria ?? '').trim();
    const telefone = (dto.telefone ?? '').trim();
    if (!nome) throw new BadRequestException('Nome do contato é obrigatório.');
    if (!categoria) throw new BadRequestException('Categoria (ex.: Eletricista) é obrigatória.');
    if (!telefone) throw new BadRequestException('Telefone é obrigatório.');
    return {
      nome,
      categoria,
      telefone,
      observacao: dto.observacao?.trim() || null,
    };
  }

  async getAll(idCondominio: number, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) {
      return [
        { id: 1, nome: 'João Elétrica', categoria: 'Eletricista', telefone: '11999990000', observacao: 'Atende emergência 24h' },
        { id: 2, nome: 'Hidro Express', categoria: 'Encanador', telefone: '11988887777', observacao: null },
      ];
    }
    return this.prisma.contatos_Uteis.findMany({
      where: { id_condominio: Number(idCondominio), ativo: 1 },
      select: {
        id: true,
        nome: true,
        categoria: true,
        telefone: true,
        observacao: true,
        created_at: true,
      },
      orderBy: [{ categoria: 'asc' }, { nome: 'asc' }],
    });
  }

  async insert(idCondominio: number, contato: ContatoDto, user?: JwtPayload) {
    assertStaff(user, 'cadastrar contato útil');
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) return { success: true };
    const data = this.normalizar(contato);
    await this.prisma.contatos_Uteis.create({
      data: { ...data, id_condominio: Number(idCondominio) },
    });
    return { success: true };
  }

  async update(idCondominio: number, contato: ContatoDto, user?: JwtPayload) {
    assertStaff(user, 'editar contato útil');
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) return { success: true };
    const id = Number(contato?.id);
    if (!id) throw new BadRequestException('Contato inválido.');
    // Confere o dono ANTES de atualizar: sem isto, um síndico de outro
    // condomínio editaria o contato deste só mandando o id certo.
    const atual = await this.prisma.contatos_Uteis.findUnique({
      where: { id },
      select: { id_condominio: true },
    });
    if (!atual) throw new NotFoundException('Contato não encontrado.');
    await this.tenant.assertEntidade(atual.id_condominio, user, `contato #${id}`);
    const data = this.normalizar(contato);
    await this.prisma.contatos_Uteis.update({ where: { id }, data });
    return { success: true };
  }

  async remove(id: number, user?: JwtPayload) {
    assertStaff(user, 'remover contato útil');
    if (!this.prisma.isConnected) return { success: true };
    const atual = await this.prisma.contatos_Uteis.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true },
    });
    if (!atual) throw new NotFoundException('Contato não encontrado.');
    await this.tenant.assertEntidade(atual.id_condominio, user, `contato #${id}`);
    await this.prisma.contatos_Uteis.delete({ where: { id: Number(id) } });
    return { success: true };
  }
}

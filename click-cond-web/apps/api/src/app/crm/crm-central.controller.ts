import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { CrmAdminGuard } from './crm-admin.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { novoCredOperador } from '../central/central-auth.service';
import { gerarSenhaSip } from '../interfone/interfone-config.service';

/** Mesmo custo do resto da API (login do console, troca de senha do operador). */
const CUSTO_BCRYPT_SENHA = 12;
/** Senha temporária: 12 caracteres [A-Za-z0-9] de crypto.randomBytes (o operador troca no 1º login). */
const TAMANHO_SENHA_TEMPORARIA = 12;
const NOME_MAXIMO = 120;
const EMAIL_MAXIMO = 190;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** O que o CRM vê de um operador: nunca senha, hash nem o carimbo `cred`. */
export interface OperadorCentralCrm {
  id: number;
  nome: string;
  email: string;
  ativo: boolean;
  trocar_senha: boolean;
  ultimo_acesso: Date | null;
  created_at: Date;
}

/**
 * Operadores da central Prestare, cadastrados pelo admin do CRM. A senha
 * temporária aparece UMA vez (na resposta de criar ou de nova senha) e o
 * operador é obrigado a trocar no primeiro login (`trocar_senha = 1`). Criar,
 * desativar/reativar e nova senha trocam o carimbo `cred`, que derruba os
 * tokens já emitidos (a JwtStrategy confere o carimbo).
 *
 * Operador não pertence a condomínio, então a Auditoria (presa a id_condominio)
 * não serve: as ações vão para o log da API, sem a senha. `@SkipAudit` também
 * nas rotas que devolvem senha, para o corpo nunca ser gravado.
 */
@UseGuards(CrmAdminGuard)
@Controller('crm/central')
export class CrmCentralController {
  private readonly logger = new Logger(CrmCentralController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get('operadores')
  async listar(): Promise<OperadorCentralCrm[]> {
    const l = await this.prisma.central_Operadores.findMany({
      select: { id: true, nome: true, email: true, ativo: true, trocar_senha: true, ultimo_acesso: true, created_at: true },
      orderBy: { nome: 'asc' },
    });
    return l.map((o) => ({
      id: o.id,
      nome: o.nome,
      email: o.email,
      ativo: o.ativo === 1,
      trocar_senha: o.trocar_senha === 1,
      ultimo_acesso: o.ultimo_acesso ?? null,
      created_at: o.created_at,
    }));
  }

  @Header('Cache-Control', 'no-store')
  @SkipAudit()
  @Post('operadores')
  async criar(@Body() body: { nome?: unknown; email?: unknown }, @ReqUser() user?: JwtPayload): Promise<{ id: number; senha_temporaria: string }> {
    const nome = typeof body?.nome === 'string' ? body.nome.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!nome || nome.length > NOME_MAXIMO) throw new BadRequestException(`Nome é obrigatório (até ${NOME_MAXIMO} caracteres).`);
    if (!EMAIL_RE.test(email) || email.length > EMAIL_MAXIMO) throw new BadRequestException('E-mail inválido.');
    if (await this.prisma.central_Operadores.findUnique({ where: { email } })) throw this.emailEmUso();

    const senha = gerarSenhaSip(TAMANHO_SENHA_TEMPORARIA);
    const senha_hash = await bcrypt.hash(senha, CUSTO_BCRYPT_SENHA);
    let id: number;
    try {
      const op = await this.prisma.central_Operadores.create({
        data: { nome, email, senha_hash, trocar_senha: 1, ativo: 1, cred: novoCredOperador() },
      });
      id = op.id;
    } catch (e: any) {
      // Outro cadastro gravou o mesmo e-mail entre a consulta e a gravação.
      if (e?.code === 'P2002') throw this.emailEmUso();
      throw e;
    }
    this.registrar(user, `operador #${id} cadastrado`);
    return { id, senha_temporaria: senha };
  }

  @SkipAudit()
  @Post('operadores/:id/ativo')
  @HttpCode(200)
  async ativo(@Param('id', ParseIntPipe) id: number, @Body('ligado') ligado: boolean, @ReqUser() user?: JwtPayload): Promise<{ id: number; ativo: boolean }> {
    if (typeof ligado !== 'boolean') throw new BadRequestException('ligado deve ser true ou false.');
    await this.operador(id);
    await this.prisma.central_Operadores.update({ where: { id }, data: { ativo: ligado ? 1 : 0, cred: novoCredOperador() } });
    this.registrar(user, `operador #${id} ${ligado ? 'reativado' : 'desativado'}`);
    return { id, ativo: ligado };
  }

  @Header('Cache-Control', 'no-store')
  @SkipAudit()
  @Post('operadores/:id/nova-senha')
  @HttpCode(200)
  async novaSenha(@Param('id', ParseIntPipe) id: number, @ReqUser() user?: JwtPayload): Promise<{ senha_temporaria: string }> {
    await this.operador(id);
    const senha = gerarSenhaSip(TAMANHO_SENHA_TEMPORARIA);
    const senha_hash = await bcrypt.hash(senha, CUSTO_BCRYPT_SENHA);
    await this.prisma.central_Operadores.update({ where: { id }, data: { senha_hash, trocar_senha: 1, cred: novoCredOperador() } });
    this.registrar(user, `operador #${id} recebeu senha temporária nova`);
    return { senha_temporaria: senha };
  }

  private async operador(id: number) {
    const op = await this.prisma.central_Operadores.findUnique({ where: { id } });
    if (!op) throw new NotFoundException('Operador não encontrado.');
    return op;
  }

  private emailEmUso() {
    return new ConflictException({ statusCode: 409, motivo: 'email_em_uso', message: 'Já existe um operador com este e-mail.' });
  }

  private registrar(user: JwtPayload | undefined, acao: string): void {
    this.logger.log(`Central: ${acao} pelo admin do CRM #${Number(user?.sub) || '?'}`);
  }
}

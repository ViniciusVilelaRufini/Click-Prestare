import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Autenticação dos administradores do CRM Comercial (operadora Click Prestare).
 * Separada do login da portaria: valida contra a tabela `crm_admins` e emite
 * um JWT com role 'crm_admin', exigido pelo CrmAdminGuard nas rotas de dados.
 */
@Injectable()
export class CrmAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(login: string, senha: string) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    const admin = await this.prisma.crm_Admins.findFirst({
      where: { login, ativo: 1 },
    });

    if (!admin) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const isMatch = await bcrypt.compare(senha, admin.password);
    if (!isMatch) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const payload: JwtPayload = {
      sub: admin.id,
      nome: admin.nome,
      role: 'crm_admin',
    };

    return {
      access_token: this.jwt.sign(payload),
      id: admin.id,
      nome: admin.nome,
      role: 'crm_admin',
    };
  }
}

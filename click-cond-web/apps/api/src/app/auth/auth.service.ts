import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from './jwt-payload.interface';
import { QrSessionStore } from './qr-session.store';

/**
 * Lockout em memória por login. Após N tentativas falhas em janela,
 * trava o login por X minutos. Defende contra password spray que muda
 * de IP a cada tentativa (escapando do rate limit por IP).
 */
interface LockoutEntry {
  failedAt: number[];
  lockedUntil: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly lockouts = new Map<string, LockoutEntry>();
  private readonly maxFailures = Number(process.env.AUTH_MAX_FAILURES ?? 8);
  private readonly failureWindowMs = Number(process.env.AUTH_FAILURE_WINDOW_MS ?? 600_000);
  private readonly lockoutMs = Number(process.env.AUTH_LOCKOUT_MS ?? 900_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly qrStore: QrSessionStore,
  ) {}

  private isLocked(login: string): boolean {
    const entry = this.lockouts.get(login);
    if (!entry) return false;
    if (entry.lockedUntil > Date.now()) return true;
    if (entry.lockedUntil && entry.lockedUntil <= Date.now()) {
      // Janela expirou — limpa.
      this.lockouts.delete(login);
    }
    return false;
  }

  private registrarFalha(login: string) {
    const now = Date.now();
    const entry = this.lockouts.get(login) ?? { failedAt: [], lockedUntil: 0 };
    // Mantém só falhas dentro da janela.
    entry.failedAt = entry.failedAt.filter((t) => now - t < this.failureWindowMs);
    entry.failedAt.push(now);
    if (entry.failedAt.length >= this.maxFailures) {
      entry.lockedUntil = now + this.lockoutMs;
      this.logger.warn(`Login "${login}" travado por ${this.lockoutMs / 60_000}min após ${entry.failedAt.length} falhas`);
    }
    this.lockouts.set(login, entry);
  }

  private limparFalhas(login: string) {
    this.lockouts.delete(login);
  }

  /**
   * Condomínios administrados pelo síndico dono deste login (vazio se o login
   * não for de síndico).
   *
   * O síndico costuma ter também um registro em Funcionarios_Portaria com o
   * mesmo login, e é por ele que o login da web passa. Sem consultar por login,
   * a lista de condomínios nunca chegaria a quem entra por esse caminho.
   */
  private async condominiosDoSindicoPorLogin(login: string) {
    const user = await this.prisma.users.findFirst({
      where: { login },
      include: {
        sindicos: { select: { id: true } },
        sindicosCondominios: {
          include: { condominio: { select: { nome: true } } },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!user || user.sindicos.length === 0) return [];
    return user.sindicosCondominios.map((v) => ({
      id: v.id_condominio,
      nome: v.condominio?.nome || 'Condomínio',
    }));
  }

  async loginPortaria(login: string, senha: string) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    // Lockout por login antes mesmo do lookup no banco — evita user enumeration
    // (resposta diferente quando login existe vs. quando não existe).
    if (this.isLocked(login)) {
      throw new UnauthorizedException(
        'Muitas tentativas falhas. Tente novamente mais tarde.',
      );
    }

    const funcionario = await this.prisma.funcionarios_Portaria.findFirst({
      where: { login, ativo: 1 },
    });

    if (funcionario) {
      const isBcrypt = funcionario.password.startsWith('$2');
      let isMatch = false;

      if (isBcrypt) {
        isMatch = await bcrypt.compare(senha, funcionario.password);
      } else {
        const md5Password = createHash('md5').update(senha).digest('hex');
        isMatch = funcionario.password === md5Password;
        if (isMatch) {
          const newHash = await bcrypt.hash(senha, 12);
          await this.prisma.funcionarios_Portaria.update({
            where: { id: funcionario.id },
            data: { password: newHash },
          });
        }
      }

      if (isMatch) {
        this.limparFalhas(login);

        const cond = await this.prisma.condominios.findUnique({
          where: { id: funcionario.id_condominio },
          select: { nome: true },
        });

        const payload: JwtPayload = {
          sub: funcionario.id,
          nome: funcionario.nome,
          id_condominio: funcionario.id_condominio,
          turno: funcionario.turno,
        };

        return {
          access_token: this.jwt.sign(payload),
          id: funcionario.id,
          nome: funcionario.nome,
          turno: funcionario.turno,
          id_condominio: funcionario.id_condominio,
          condominio_nome: cond?.nome || 'Click Condomínio',
          condominios: await this.condominiosDoSindicoPorLogin(login),
        };
      }

      // Senha não bate com o funcionário — verifica se é o síndico do mesmo condomínio
      // que trocou a senha pelo app (auto-sincroniza a senha do porteiro nesse caso).
      const sindLinks = await this.prisma.sindicos_Condominios.findMany({
        where: { id_condominio: funcionario.id_condominio },
        include: { user: true },
      });
      for (const link of sindLinks) {
        if (!link.user?.password) continue;
        const pwdIsBcrypt = link.user.password.startsWith('$2');
        const sindicoMatch = pwdIsBcrypt
          ? await bcrypt.compare(senha, link.user.password)
          : createHash('md5').update(senha).digest('hex') === link.user.password;
        if (sindicoMatch) {
          // Sincroniza a senha do porteiro com a do síndico
          const synced = await bcrypt.hash(senha, 12);
          await this.prisma.funcionarios_Portaria.update({
            where: { id: funcionario.id },
            data: { password: synced },
          });
          this.limparFalhas(login);
          const cond = await this.prisma.condominios.findUnique({
            where: { id: funcionario.id_condominio },
            select: { nome: true },
          });
          const payload: JwtPayload = {
            sub: funcionario.id,
            nome: funcionario.nome,
            id_condominio: funcionario.id_condominio,
            turno: funcionario.turno,
          };
          return {
            access_token: this.jwt.sign(payload),
            id: funcionario.id,
            nome: funcionario.nome,
            turno: funcionario.turno,
            id_condominio: funcionario.id_condominio,
            condominio_nome: cond?.nome || 'Click Condomínio',
            condominios: await this.condominiosDoSindicoPorLogin(login),
          };
        }
      }
      // Nenhum síndico do condomínio bateu — tenta autenticar como síndico abaixo.
    }

    // Fallback: tenta autenticar como síndico (criado pelo app mobile).
    const user = await this.prisma.users.findFirst({
      where: { login },
      include: {
        sindicos: true,
        sindicosCondominios: {
          include: { condominio: { select: { nome: true } } },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!user || !user.sindicos || user.sindicos.length === 0) {
      this.registrarFalha(login);
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    if (!user.sindicosCondominios || user.sindicosCondominios.length === 0) {
      this.registrarFalha(login);
      throw new UnauthorizedException('Síndico sem condomínio vinculado.');
    }

    const pwdStored = user.password ?? '';
    const isBcryptSindico = pwdStored.startsWith('$2');
    let sindicoMatch = false;

    if (isBcryptSindico) {
      sindicoMatch = await bcrypt.compare(senha, pwdStored);
    } else {
      const md5Password = createHash('md5').update(senha).digest('hex');
      sindicoMatch = pwdStored === md5Password;
    }

    if (!sindicoMatch) {
      this.registrarFalha(login);
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    this.limparFalhas(login);

    const sindico = user.sindicos[0];
    const vinculo = user.sindicosCondominios[0];

    const sindicoPayload: JwtPayload = {
      sub: user.id,
      nome: sindico.name,
      id_condominio: vinculo.id_condominio,
      turno: 'Síndico',
      typeAccess: 'Sindico',
    };

    return {
      access_token: this.jwt.sign(sindicoPayload),
      id: user.id,
      nome: sindico.name,
      turno: 'Síndico',
      id_condominio: vinculo.id_condominio,
      condominio_nome: vinculo.condominio?.nome || 'Click Condomínio',
      // Síndico pode administrar mais de um condomínio. A web entrava sempre no
      // primeiro vínculo; devolvendo a lista, ela pergunta em qual entrar.
      condominios: user.sindicosCondominios.map((v) => ({
        id: v.id_condominio,
        nome: v.condominio?.nome || 'Condomínio',
      })),
    };
  }

  /**
   * Troca o condomínio ativo do síndico na web, emitindo um token novo com o
   * escopo escolhido. Usado na seleção pós-login e no seletor da barra lateral.
   *
   * Só aceita condomínio ao qual o síndico esteja realmente vinculado — o id vem
   * do cliente, então sem essa checagem daria para escopar o token em condomínio
   * alheio e ler os dados dele.
   */
  async selecionarCondominio(payload: JwtPayload, idCondominio: number) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    // O síndico chega aqui por dois caminhos: token de síndico (sub = Users.id)
    // ou token de funcionário, quando existe Funcionarios_Portaria com o mesmo
    // login — o caso comum na web. Resolve o Users.id em ambos.
    let idUserSindico: number | null = null;
    if (payload.typeAccess === 'Sindico') {
      idUserSindico = payload.sub;
    } else {
      const funcionario = await this.prisma.funcionarios_Portaria.findUnique({
        where: { id: payload.sub },
        select: { login: true },
      });
      if (funcionario?.login) {
        const user = await this.prisma.users.findFirst({
          where: { login: funcionario.login },
          include: { sindicos: { select: { id: true } } },
        });
        if (user && user.sindicos.length > 0) idUserSindico = user.id;
      }
    }

    if (!idUserSindico) {
      throw new UnauthorizedException('Apenas síndicos podem trocar de condomínio.');
    }

    const vinculo = await this.prisma.sindicos_Condominios.findFirst({
      where: { id_user: idUserSindico, id_condominio: Number(idCondominio) },
      include: { condominio: { select: { nome: true } } },
    });
    if (!vinculo) {
      throw new UnauthorizedException('Você não administra este condomínio.');
    }

    // Preserva a identidade do token (sub/turno/typeAccess) e troca só o escopo:
    // mudar o sub aqui quebraria fluxos que resolvem o usuário por ele, como a
    // troca de senha.
    const novoPayload: JwtPayload = {
      ...payload,
      id_condominio: vinculo.id_condominio,
    };
    delete (novoPayload as any).iat;
    delete (novoPayload as any).exp;

    return {
      access_token: this.jwt.sign(novoPayload),
      id: payload.sub,
      nome: payload.nome,
      turno: payload.turno ?? 'Síndico',
      id_condominio: vinculo.id_condominio,
      condominio_nome: vinculo.condominio?.nome || 'Click Condomínio',
    };
  }

  async changePassword(id: number, senhaAtual: string, novaSenha: string, typeAccess?: string) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    // Síndicos logados via portaria-web têm sub = users.id e typeAccess = 'Sindico'.
    if (typeAccess === 'Sindico') {
      const user = await this.prisma.users.findUnique({ where: { id } });
      if (!user) throw new UnauthorizedException('Usuário não encontrado.');

      const stored = user.password ?? '';
      const isMatch = stored.startsWith('$2')
        ? await bcrypt.compare(senhaAtual, stored)
        : stored === createHash('md5').update(senhaAtual).digest('hex');

      if (!isMatch) throw new UnauthorizedException('Senha atual incorreta.');

      const newHash = await bcrypt.hash(novaSenha, 12);
      await this.prisma.users.update({ where: { id }, data: { password: newHash } });
      return { success: true, message: 'Senha atualizada com sucesso.' };
    }

    const funcionario = await this.prisma.funcionarios_Portaria.findUnique({
      where: { id },
    });

    if (!funcionario) {
      throw new UnauthorizedException('Funcionário não encontrado.');
    }

    const isBcrypt = funcionario.password.startsWith('$2');
    let isMatch = false;

    if (isBcrypt) {
      isMatch = await bcrypt.compare(senhaAtual, funcionario.password);
    } else {
      const md5Password = createHash('md5').update(senhaAtual).digest('hex');
      isMatch = funcionario.password === md5Password;
    }

    if (!isMatch) {
      throw new UnauthorizedException('Senha atual incorreta.');
    }

    const newHash = await bcrypt.hash(novaSenha, 12);
    await this.prisma.funcionarios_Portaria.update({
      where: { id },
      data: { password: newHash },
    });

    return { success: true, message: 'Senha updated com sucesso.' };
  }

  async getCondominioNome(id: number) {
    if (!this.prisma.isConnected) {
      return { nome: 'Click Condomínio' };
    }
    const cond = await this.prisma.condominios.findUnique({
      where: { id },
      select: { nome: true },
    });
    return { nome: cond?.nome || 'Click Condomínio' };
  }

  /**
   * Garante que o usuário autenticado tem vínculo com o condomínio antes de
   * emitir um token de portaria via QR. Síndico: precisa estar em
   * Sindicos_Condominios. Demais (porteiro/app): via Funcionarios ou
   * Funcionarios_Portaria do condomínio.
   */
  /**
   * Confirma o vínculo com o condomínio e devolve o papel REAL, resolvido no
   * banco (não o que veio no token). Quem chama usa isso para carimbar o
   * typeAccess do token de portaria — daí a diferença entre 'Funcionario'
   * (equipe do condomínio, tem alçada administrativa) e o porteiro do console,
   * que continua sem typeAccess e portanto sem alçada no financeiro.
   */
  private async assertVinculoCondominio(
    userId: number,
    typeAccess: string,
    idCondominio: number,
  ): Promise<'Sindico' | 'Funcionario' | null> {
    if (!this.prisma.isConnected) return null;

    const tipo = (typeAccess ?? '').toLowerCase();

    if (tipo === 'sindico') {
      const vinculo = await this.prisma.sindicos_Condominios.findFirst({
        where: { id_user: userId, id_condominio: idCondominio },
        select: { id: true },
      });
      if (!vinculo) {
        throw new UnauthorizedException('Você não tem vínculo com este condomínio.');
      }
      return 'Sindico';
    }

    // Funcionário/porteiro: vínculo via Funcionarios (id_user) ou, para o
    // porteiro-web, via Funcionarios_Portaria.
    const func = await this.prisma.funcionarios.findFirst({
      where: { id_user: userId, id_condominio: idCondominio },
      select: { id: true },
    });
    if (func) return 'Funcionario';

    const funcPortaria = await this.prisma.funcionarios_Portaria.findFirst({
      where: { id: userId, id_condominio: idCondominio },
      select: { id: true },
    });
    if (funcPortaria) return null;

    throw new UnauthorizedException('Você não tem vínculo com este condomínio.');
  }

  createQrSession() {
    const session = this.qrStore.create();
    return { qrToken: session.qrToken, expiresAt: session.expiresAt };
  }

  async getQrStatus(qrToken: string) {
    const session = this.qrStore.get(qrToken);
    if (!session) {
      return { status: 'expired' };
    }

    if (session.status === 'confirmed') {
      return {
        status: 'confirmed',
        access_token: session.access_token,
        id: session.idUser,
        nome: session.nome,
        turno: session.typeAccess === 'Sindico' ? 'Síndico' : 'Porteiro (App)',
        id_condominio: session.id_condominio,
        condominio_nome: session.condominio_nome,
      };
    }

    return { status: 'pending' };
  }

  async authorizeQrSession(payload: JwtPayload, qrToken: string, idCondominio: number) {
    const session = this.qrStore.get(qrToken);
    if (!session) {
      throw new UnauthorizedException('QR Code expirado ou inválido.');
    }

    if (session.status !== 'pending') {
      throw new UnauthorizedException('Sessão QR Code já processada.');
    }

    const cond = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: { nome: true },
    });

    if (!cond) {
      throw new UnauthorizedException('Condomínio não encontrado.');
    }

    const userId = payload.sub;
    const typeAccess = payload.typeAccess ?? 'Sindico';

    // Verifica que o usuário autenticado realmente tem vínculo com o condomínio
    // solicitado. Sem isso, um síndico de um condomínio mintava um token de
    // portaria para QUALQUER condomínio só passando o id_condominio no body.
    const papelReal = await this.assertVinculoCondominio(userId, typeAccess, idCondominio);
    const nomeUsuario = payload.nome;

    const portariaPayload: JwtPayload = {
      sub: userId,
      nome: nomeUsuario,
      id_condominio: idCondominio,
      turno: typeAccess === 'Sindico' ? 'Síndico' : 'Porteiro (App)',
      // typeAccess precisa entrar no token: o módulo financeiro usa assertStaff
      // (exige Sindico/Funcionario) para lançar, editar, dar baixa e fechar
      // competência, e o get-all decide pelo typeAccess se mostra os
      // lançamentos em aberto. Sem ele, quem entrava na portaria-web pelo QR
      // Code via um livro caixa só com o que já estava pago e tomava 403 em
      // qualquer alteração — o login por senha funcionava, o por QR não.
      // Vem do vínculo conferido no banco, não do token de origem.
      ...(papelReal ? { typeAccess: papelReal } : {}),
    };

    const accessToken = this.jwt.sign(portariaPayload);

    this.qrStore.confirm(qrToken, {
      idUser: userId,
      nome: nomeUsuario,
      typeAccess,
      id_condominio: idCondominio,
      condominio_nome: cond.nome,
      access_token: accessToken,
    });

    return { success: true };
  }
}

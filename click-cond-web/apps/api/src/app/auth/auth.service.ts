import { BadRequestException, ForbiddenException, Injectable, Logger, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from './jwt-payload.interface';
import { QrSessionStore } from './qr-session.store';
import { EstadoCompartilhado } from '../common/estado-compartilhado';
import { autorDoToken, idUsuarioDoToken } from './usuario-do-token.util';
import { TenantAccessService } from './tenant-access.service';
import { MfaService } from './mfa/mfa.service';
import { momentoTrocaSenha } from './senha-alterada.util';
import { carimboCredencialPortaria } from './credencial-portaria.util';
import { AuditoriaService, type AuditoriaAutorTipo } from '../auditoria/auditoria.service';

/**
 * Lockout por login: após N tentativas falhas na janela, trava o login por X
 * minutos. Defende contra password spray que muda de IP a cada tentativa
 * (escapando do rate limit por IP).
 *
 * Fica em `estado_compartilhado` para valer nas 2 instâncias atrás do ALB (num
 * Map do processo cada instância contava sozinha e o limite dobrava). Uma linha
 * por falha (`login-falha:<hash>:<uuid>`, TTL = janela) em vez de um contador:
 * insert não perde contagem com requisições simultâneas, e o TTL de cada linha
 * dá a janela deslizante. A trava é `login-trava:<hash>` (TTL = trava). O login
 * entra como hash, não em claro.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly maxFailures = Number(process.env.AUTH_MAX_FAILURES ?? 8);
  private readonly failureWindowMs = Number(process.env.AUTH_FAILURE_WINDOW_MS ?? 600_000);
  private readonly lockoutMs = Number(process.env.AUTH_LOCKOUT_MS ?? 900_000);
  private readonly portariaJwtExpiresIn = (process.env.PORTARIA_JWT_EXPIRES_IN ?? '24h') as any;
  /**
   * Sessões de síndico aguardando o código do e-mail, por mfa_token. Ficam em estado_compartilhado
   * (`mfa-console:<token>`, TTL do desafio): com 2 instâncias o login cai numa e o código é conferido
   * na outra. Sem banco, memória do processo. O lockout por login usa o mesmo estado
   * (`login-falha:*`, `login-trava:*`).
   */
  private _estado?: EstadoCompartilhado;
  private get estadoMfa(): EstadoCompartilhado {
    return (this._estado ??= new EstadoCompartilhado(this.prisma));
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly qrStore: QrSessionStore,
    private readonly tenant?: TenantAccessService,
    @Optional() private readonly mfa?: MfaService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /**
   * Linha de auditoria do login do console: 'LOGIN' quando uma sessão é EMITIDA para um condomínio (uma
   * por sessão, não por etapa do MFA) e 'LOGIN_FALHA' quando a conta existe e a senha/código não confere.
   *
   * Dispara sem await, de propósito: a resposta de "senha errada" (conta existe) não pode demorar mais
   * que a de "conta inexistente" (que não tem condomínio e não grava nada) por causa de um INSERT, nem o
   * login pode falhar porque o log falhou. O IP vem do contexto da requisição, lido de forma síncrona
   * dentro de `registrar`. Nunca recebe senha, código ou token: só o método e o login digitado.
   */
  private auditarLogin(
    acao: 'LOGIN' | 'LOGIN_FALHA',
    idCondominio: number | null | undefined,
    autor: { id: number | null; tipo: AuditoriaAutorTipo | null; nome?: string | null; email?: string | null },
    detalhes: { metodo: 'senha' | 'mfa' | 'qr' | 'troca_condominio'; login?: string; id_condominio_origem?: number },
  ): void {
    if (!this.auditoria || !idCondominio) return;
    const rotulo: Record<string, string> = {
      senha: 'senha',
      mfa: 'código de verificação',
      qr: 'QR Code',
      troca_condominio: 'troca de condomínio',
    };
    const descricao =
      acao === 'LOGIN'
        ? `Login no console da portaria (${rotulo[detalhes.metodo]})`
        : `Tentativa de login no console da portaria com ${detalhes.metodo === 'mfa' ? 'código de verificação incorreto' : 'senha incorreta'}`;
    try {
      void this.auditoria
        .registrar({
          id_condominio: Number(idCondominio),
          usuario_nome: autor.nome?.trim() || 'Usuário',
          usuario_email: autor.email?.trim() || undefined,
          autor_id: autor.id,
          autor_tipo: autor.tipo,
          acao,
          modulo: 'auth',
          descricao,
          detalhes,
        })
        .catch((e: any) => this.logger.warn(`Auditoria de login não gravada: ${e?.message ?? e}`));
    } catch (e: any) {
      this.logger.warn(`Auditoria de login não gravada: ${e?.message ?? e}`);
    }
  }

  /**
   * Chave do lockout. O MySQL compara `login` sem diferenciar caixa nem espaços à direita, então
   * "Joao", "JOAO" e "joao " são a MESMA conta no banco; com a string crua como chave, cada variação
   * ganhava um contador próprio e o lockout nunca disparava (pentest 04/11). Vai como hash para a
   * tabela compartilhada (o login é e-mail, dado pessoal).
   */
  private chaveLockout(login: string): string {
    const normalizado = String(login ?? '').trim().toLowerCase();
    return createHash('sha256').update(normalizado).digest('hex').slice(0, 40);
  }

  private async isLocked(loginBruto: string): Promise<boolean> {
    try {
      return !!(await this.estadoMfa.obter(`login-trava:${this.chaveLockout(loginBruto)}`));
    } catch (e: any) {
      // Banco instável: não trava ninguém por isso (o login em si já depende do banco).
      this.logger.warn(`Lockout: falha ao consultar a trava: ${e?.message ?? e}`);
      return false;
    }
  }

  private async registrarFalha(loginBruto: string): Promise<void> {
    const chave = this.chaveLockout(loginBruto);
    try {
      await this.estadoMfa.definir(`login-falha:${chave}:${randomUUID()}`, 1, this.failureWindowMs);
      const falhas = await this.estadoMfa.listarPorPrefixo(`login-falha:${chave}:`);
      if (falhas.length >= this.maxFailures) {
        await this.estadoMfa.definir(`login-trava:${chave}`, 1, this.lockoutMs);
        this.logger.warn(`Login ${chave.slice(0, 8)}… travado por ${this.lockoutMs / 60_000}min após ${falhas.length} falhas`);
      }
    } catch (e: any) {
      this.logger.warn(`Lockout: falha ao registrar tentativa: ${e?.message ?? e}`);
    }
  }

  private async limparFalhas(login: string): Promise<void> {
    const chave = this.chaveLockout(login);
    try {
      await this.estadoMfa.removerPorPrefixo(`login-falha:${chave}:`);
      await this.estadoMfa.remover(`login-trava:${chave}`);
    } catch (e: any) {
      this.logger.warn(`Lockout: falha ao limpar tentativas: ${e?.message ?? e}`);
    }
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
          // Condomínio desativado no CRM não entra na lista: escolhê-lo era recusado (o mesmo corte do loginPortaria).
          where: { condominio: { ativo: 1 } },
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

  /**
   * Síndico dono deste login, se ele administra ESTE condomínio.
   *
   * O síndico quase sempre tem também um registro em Funcionarios_Portaria com
   * o mesmo login, e é por ele que o login da web passa. Síndico de outro
   * prédio que por acaso é funcionário deste continua entrando como
   * funcionário — daí o filtro por id_condominio.
   */
  private async sindicoDoLoginNoCondominio(login: string, idCondominio: number) {
    const user = await this.prisma.users.findFirst({
      where: { login },
      include: {
        sindicos: { select: { name: true } },
        sindicosCondominios: {
          where: { id_condominio: idCondominio },
          select: { id: true },
        },
      },
    });
    if (!user || user.sindicos.length === 0) return null;
    if (user.sindicosCondominios.length === 0) return null;
    return { id: user.id, nome: user.sindicos[0].name };
  }

  /**
   * Monta a sessão de portaria a partir do registro de Funcionarios_Portaria
   * que autenticou, carimbando o papel REAL resolvido no banco.
   *
   * O token deste caminho não carregava `typeAccess`. Como o console decide o
   * menu pelo `turno` (que no registro do síndico já vinha 'Síndico'), o
   * síndico entrava, via Financeiro/Relatórios e tomava 403 em toda escrita —
   * `assertStaff` exige Sindico/Funcionario. Toda leitura funcionava
   * (assertOperador aceita qualquer token com id_condominio), então a tela
   * carregava e só a ação falhava.
   *
   * Para o síndico o `sub` passa a ser o Users.id, não o Funcionarios_Portaria.id:
   * `selecionarCondominio` e `changePassword` resolvem o usuário por ele quando
   * typeAccess é 'Sindico', e `Visitantes.user` é FK para Users. É o mesmo
   * formato de token que o login por QR Code já emite.
   *
   * Porteiro segue sem typeAccess e portanto sem alçada no financeiro — isso é
   * intencional, não um efeito colateral.
   */
  private async montarSessaoPortaria(
    funcionario: { id: number; nome: string; turno: string | null; id_condominio: number; login: string; password: string },
    login: string,
    deviceToken?: string,
  ) {
    const cond = await this.prisma.condominios.findUnique({
      where: { id: funcionario.id_condominio },
      select: { nome: true },
    });

    const sindico = await this.sindicoDoLoginNoCondominio(login, funcionario.id_condominio);

    const payload: JwtPayload = sindico
      ? {
          sub: sindico.id,
          nome: sindico.nome,
          id_condominio: funcionario.id_condominio,
          turno: 'Síndico',
          typeAccess: 'Sindico',
        }
      : {
          sub: funcionario.id,
          nome: funcionario.nome,
          id_condominio: funcionario.id_condominio,
          turno: funcionario.turno,
          // sub = Funcionarios_Portaria.id: declarado, para ninguém inferir pela forma do token.
          tipo_sub: 'funcionario_portaria',
          // Trocar o e-mail ou a senha mantém o id: o carimbo é o que derruba a sessão aberta (JwtStrategy).
          cred: carimboCredencialPortaria(funcionario),
        };

    const resposta = {
      id: sindico ? sindico.id : funcionario.id,
      nome: sindico ? sindico.nome : funcionario.nome,
      turno: sindico ? 'Síndico' : funcionario.turno,
      id_condominio: funcionario.id_condominio,
      condominio_nome: cond?.nome || 'Click Condomínio',
      // Só lista os condomínios quando este login É o síndico do condomínio da sessão. Um porteiro cujo
      // login coincide com o e-mail de um síndico de OUTRO condomínio não pode ver nem trocar para os dele.
      condominios: sindico ? await this.condominiosDoSindicoPorLogin(login) : [],
    };

    if (sindico) {
      const desafio = await this.exigirMfaSindico(sindico.id, deviceToken, payload, resposta, login);
      if (desafio) return desafio;
    }

    const access_token = this.jwt.sign(payload, { expiresIn: this.portariaJwtExpiresIn });
    this.auditarLogin(
      'LOGIN',
      funcionario.id_condominio,
      sindico
        ? { id: sindico.id, tipo: 'user', nome: sindico.nome }
        : { id: funcionario.id, tipo: 'funcionario_portaria', nome: funcionario.nome },
      { metodo: 'senha', login },
    );
    return { access_token, ...resposta };
  }

  async loginPortaria(login: string, senha: string, deviceToken?: string) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    // O corpo da rota é tipo inline (não DTO), então o ValidationPipe não barra objeto no lugar de
    // string: `{"login": {"not": ""}}` virava filtro do Prisma e a senha não-string estourava 500.
    if (typeof login !== 'string' || typeof senha !== 'string' || !login.trim()) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Lockout por login antes mesmo do lookup no banco — evita user enumeration
    // (resposta diferente quando login existe vs. quando não existe).
    if (await this.isLocked(login)) {
      throw new UnauthorizedException(
        'Muitas tentativas falhas. Tente novamente mais tarde.',
      );
    }

    // `condominio: { ativo: 1 }`: desativar o condomínio no CRM precisa derrubar
    // a portaria junto. Sem esta condição o porteiro continuava entrando e
    // operando (abrir portão, registrar visitante) num prédio já desligado.
    const funcionario = await this.prisma.funcionarios_Portaria.findFirst({
      where: { login, ativo: 1, condominio: { ativo: 1 } },
    });

    // Conta(s) que existem para este login e cuja senha não conferiu, por condomínio. Só vira
    // LOGIN_FALHA se a tentativa terminar recusada (o fallback de síndico ainda pode autenticar).
    const falhas = new Map<number, { id: number; tipo: AuditoriaAutorTipo; nome: string; email?: string | null }>();
    const auditarFalhas = () => {
      for (const [idCondominio, autor] of falhas) {
        this.auditarLogin('LOGIN_FALHA', idCondominio, autor, { metodo: 'senha', login });
      }
    };

    // Linha de portaria cujo login é o do SÍNDICO deste condomínio: a sessão emitida seria de síndico, então só a
    // senha da conta do síndico (Users, logo abaixo) vale. Conferir a senha desta linha antes deixava a senha antiga
    // entrando depois de o síndico trocar ou redefinir a dele, que só grava Users.
    const linhaDoSindico = funcionario
      ? !!(await this.sindicoDoLoginNoCondominio(login, funcionario.id_condominio))
      : false;

    if (funcionario && !linhaDoSindico) {
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
          // O carimbo da sessão (cred) é do hash que fica gravado.
          funcionario.password = newHash;
        }
      }

      if (isMatch) {
        await this.limparFalhas(login);
        return this.montarSessaoPortaria(funcionario, login, deviceToken);
      }
      // Se a senha do funcionário não confere, não sobrescreve nem auto-sincroniza com o síndico
      // (Conformidade LGPD e isolamento estrito de credenciais/auditoria).
      falhas.set(funcionario.id_condominio, {
        id: funcionario.id,
        tipo: 'funcionario_portaria',
        nome: funcionario.nome,
        email: funcionario.email,
      });
    }

    // Fallback: tenta autenticar como síndico (criado pelo app mobile).
    const user = await this.prisma.users.findFirst({
      where: { login },
      include: {
        sindicos: true,
        // Só vínculos com condomínio ativo: um síndico que administra dois
        // prédios e teve um desativado continua entrando pelo outro, mas não
        // consegue mais operar o que foi desligado.
        sindicosCondominios: {
          where: { condominio: { ativo: 1 } },
          include: { condominio: { select: { nome: true } } },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!user || !user.sindicos || user.sindicos.length === 0) {
      await this.registrarFalha(login);
      auditarFalhas();
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const pwdStored = user.password ?? '';
    const isBcryptSindico = pwdStored.startsWith('$2');
    let sindicoMatch = false;

    if (isBcryptSindico) {
      sindicoMatch = await bcrypt.compare(senha, pwdStored);
    } else {
      const md5Password = createHash('md5').update(senha).digest('hex');
      sindicoMatch = pwdStored === md5Password;
      if (sindicoMatch) {
        try {
          const newHash = await bcrypt.hash(senha, 12);
          await this.prisma.users.update({
            where: { id: user.id },
            data: { password: newHash },
          });
          this.logger.log(`Senha do síndico ${user.id} migrada de MD5 para Bcrypt`);
        } catch (e) {
          // Não bloqueia login se falhar a migração
        }
      }
    }

    if (!sindicoMatch) {
      await this.registrarFalha(login);
      // A conta de síndico vale em todos os condomínios ativos que ele administra. Onde o mesmo login
      // também é registro de portaria, a linha já está lá (uma por condomínio).
      for (const v of user.sindicosCondominios) {
        if (!falhas.has(v.id_condominio)) {
          falhas.set(v.id_condominio, { id: user.id, tipo: 'user', nome: user.sindicos[0].name, email: user.email });
        }
      }
      auditarFalhas();
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Depois da senha: antes saía para qualquer um que digitasse o login, e revelava que a conta é de síndico.
    if (!user.sindicosCondominios || user.sindicosCondominios.length === 0) {
      auditarFalhas();
      throw new UnauthorizedException('Síndico sem condomínio ativo vinculado.');
    }

    await this.limparFalhas(login);

    const sindico = user.sindicos[0];
    const vinculo = user.sindicosCondominios[0];

    const sindicoPayload: JwtPayload = {
      sub: user.id,
      nome: sindico.name,
      id_condominio: vinculo.id_condominio,
      turno: 'Síndico',
      typeAccess: 'Sindico',
    };

    const resposta = {
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

    const desafio = await this.exigirMfaSindico(user.id, deviceToken, sindicoPayload, resposta, login);
    if (desafio) return desafio;

    const access_token = this.jwt.sign(sindicoPayload, { expiresIn: this.portariaJwtExpiresIn });
    this.auditarLogin(
      'LOGIN',
      vinculo.id_condominio,
      { id: user.id, tipo: 'user', nome: sindico.name, email: user.email },
      { metodo: 'senha', login },
    );
    return { access_token, ...resposta };
  }

  /**
   * Síndico no console passa pelo MESMO 2º fator do login do app (MobileAuthService.loginSindico):
   * aparelho confiável ou código por e-mail. O token do console carrega typeAccess 'Sindico' e vale nas
   * rotas do app, então sem isto uma senha vazada pulava o 2º fator por aqui.
   *
   * Devolve null quando pode entrar direto (aparelho confiável ou MFA não configurado — mesmo critério
   * do app); senão, o desafio, e guarda a sessão já montada até o código ser conferido.
   */
  private async exigirMfaSindico(
    idUser: number,
    deviceToken: string | undefined,
    payload: JwtPayload,
    resposta: Record<string, unknown>,
    login?: string,
  ) {
    if (!this.mfa) return null;
    if (await this.mfa.isDeviceTrusted(idUser, deviceToken)) return null;

    const user = await this.prisma.users.findUnique({ where: { id: idUser }, include: { sindicos: true } });
    const sindico = user?.sindicos?.[0];
    const email = (sindico?.email?.trim() && sindico.email.includes('@'))
      ? sindico.email.trim()
      : (user?.email?.trim() && user.email.includes('@'))
        ? user.email.trim()
        : (user?.login?.trim() && user.login.includes('@'))
          ? user.login.trim()
          : '';
    if (!email) {
      throw new BadRequestException(
        'Não há um e-mail válido vinculado a este cadastro de Síndico para envio do código de segurança de 2 etapas. Atualize o e-mail no painel.',
      );
    }

    const desafio = await this.mfa.createChallenge({ id: idUser, email, name: sindico?.name || 'Síndico' });
    await this.estadoMfa.definir(
      `mfa-console:${desafio.mfa_token}`,
      // `login`: só para a linha de auditoria da 2ª etapa (o login digitado na 1ª).
      { payload, resposta, login },
      desafio.expires_in_seconds * 1000,
    );
    return desafio;
  }

  /** 2ª etapa do login de síndico no console: confere o código e emite o token de console guardado. */
  async verificarMfaPortaria(
    mfaToken: string,
    code: string,
    rememberDevice: boolean,
    meta?: { userAgent?: string; ip?: string },
  ) {
    const chave = `mfa-console:${mfaToken}`;
    const pendente =
      typeof mfaToken === 'string' && mfaToken
        ? (await this.estadoMfa.obter<{ payload: JwtPayload; resposta: Record<string, unknown>; login?: string }>(chave))?.valor
        : undefined;
    if (!pendente || !this.mfa) {
      if (typeof mfaToken === 'string' && mfaToken) await this.estadoMfa.remover(chave);
      throw new UnauthorizedException('Código expirado ou inválido. Faça login novamente.');
    }

    // verifyChallenge confere o código (limite de 5 tentativas) e apaga o desafio. O token de app que
    // ele também assina é descartado: o console recebe o token de console montado no login.
    // O pendente só existe para síndico (sub = Users.id, carimbado no login).
    const autor = { id: Number(pendente.payload.sub) || null, tipo: 'user' as const, nome: pendente.payload.nome };
    const detalhes = { metodo: 'mfa' as const, ...(pendente.login ? { login: pendente.login } : {}) };

    let verificado: Awaited<ReturnType<MfaService['verifyChallenge']>>;
    try {
      verificado = await this.mfa.verifyChallenge(mfaToken, code, rememberDevice, meta);
    } catch (e: any) {
      // 401 = código incorreto; 429 = desafio invalidado por excesso de erros. Desafio expirado (400) e
      // banco fora (503) não são tentativa com código errado. A senha já conferiu: a conta é conhecida.
      const status = typeof e?.getStatus === 'function' ? e.getStatus() : 0;
      if (status === 401 || status === 429) {
        const lista = Array.isArray((pendente.resposta as any)?.condominios) ? (pendente.resposta as any).condominios : [];
        const ids = new Set<number>([Number(pendente.payload.id_condominio), ...lista.map((c: any) => Number(c?.id))]);
        for (const id of ids) {
          if (id) this.auditarLogin('LOGIN_FALHA', id, autor, detalhes);
        }
      }
      throw e;
    }
    await this.estadoMfa.remover(chave);

    const access_token = this.jwt.sign(pendente.payload, { expiresIn: this.portariaJwtExpiresIn });
    this.auditarLogin('LOGIN', pendente.payload.id_condominio, autor, detalhes);
    return {
      access_token,
      ...pendente.resposta,
      device_token: verificado.device_token,
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
    if ((payload as any).role === 'crm_admin') {
      throw new ForbiddenException('Apenas síndicos podem trocar de condomínio.');
    }
    if (payload.typeAccess === 'Sindico') {
      idUserSindico = payload.sub;
    } else if (!payload.typeAccess && payload.id_condominio && payload.tipo_sub === 'funcionario_portaria') {
      // Só o token de console do porteiro tem sub = Funcionarios_Portaria.id, e é o único que o
      // montarSessaoPortaria carimba com tipo_sub. Antes o ramo era escolhido pela FORMA do token
      // (sem typeAccess, com condomínio), que o login por QR também produzia com sub = Users.id.
      const funcionario = await this.prisma.funcionarios_Portaria.findFirst({
        where: { id: payload.sub, ativo: 1, condominio: { ativo: 1 } },
        select: { login: true, id_condominio: true },
      });
      if (funcionario?.login) {
        const user = await this.prisma.users.findFirst({
          where: { login: funcionario.login },
          include: { sindicos: { select: { id: true } } },
        });
        // O síndico precisa administrar o condomínio do PRÓPRIO porteiro: o login do porteiro é livre
        // e podia ser o e-mail de um síndico de outro condomínio.
        if (user && user.sindicos.length > 0) {
          const dono = await this.prisma.sindicos_Condominios.findFirst({
            where: { id_user: user.id, id_condominio: funcionario.id_condominio },
            select: { id: true },
          });
          if (dono) idUserSindico = user.id;
        }
      }
    }

    if (!idUserSindico) {
      throw new ForbiddenException('Apenas síndicos podem trocar de condomínio.');
    }

    const vinculo = await this.prisma.sindicos_Condominios.findFirst({
      // condominio.ativo: o mesmo corte do loginPortaria — condomínio desativado no CRM não ganha sessão.
      where: { id_user: idUserSindico, id_condominio: Number(idCondominio), condominio: { ativo: 1 } },
      include: { condominio: { select: { nome: true } } },
    });
    if (!vinculo) {
      throw new ForbiddenException('Você não administra este condomínio.');
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

    // Trocar de condomínio não renova a sessão: o token novo vence junto com o de origem (ou antes,
    // pelo teto da portaria). Sem isto, chamar a rota no próprio condomínio a cada 23h mantinha a
    // sessão viva para sempre, sem senha.
    const expOrigem = typeof (payload as any).exp === 'number' ? (payload as any).exp : null;
    const agora = Math.floor(Date.now() / 1000);
    if (expOrigem !== null && expOrigem <= agora) {
      throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    }
    // iat fixado em `agora`: senão o jsonwebtoken lê o relógio de novo e, se o segundo virar no meio,
    // o exp sai 1s depois do de origem.
    const assinado = { ...novoPayload, iat: agora };
    let accessToken = this.jwt.sign(assinado, { expiresIn: this.portariaJwtExpiresIn });
    const expNovo = (this.jwt.decode(accessToken) as any)?.exp;
    if (expOrigem !== null && typeof expNovo === 'number' && expNovo > expOrigem) {
      accessToken = this.jwt.sign(assinado, { expiresIn: expOrigem - agora });
    }

    const autor = autorDoToken(payload);
    this.auditarLogin(
      'LOGIN',
      vinculo.id_condominio,
      { id: autor.autor_id, tipo: autor.autor_tipo, nome: payload.nome, email: payload.email },
      {
        metodo: 'troca_condominio',
        ...(payload.id_condominio ? { id_condominio_origem: Number(payload.id_condominio) } : {}),
      },
    );

    return {
      access_token: accessToken,
      id: payload.sub,
      nome: payload.nome,
      turno: payload.turno ?? 'Síndico',
      id_condominio: vinculo.id_condominio,
      condominio_nome: vinculo.condominio?.nome || 'Click Condomínio',
    };
  }

  async changePassword(id: number, senhaAtual: string, novaSenha: string, typeAccess?: string, sessao?: JwtPayload) {
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

      if (!isMatch) throw new BadRequestException('Senha atual incorreta.');

      const newHash = await bcrypt.hash(novaSenha, 12);
      await this.prisma.users.update({ where: { id }, data: { password: newHash, senha_alterada_em: momentoTrocaSenha() } });
      // A troca derruba as sessões anteriores (inclusive esta). Devolve um token novo com o mesmo escopo
      // para o console que fez a troca seguir logado.
      let access_token: string | undefined;
      if (sessao) {
        const novoPayload: any = { ...sessao };
        delete novoPayload.iat;
        delete novoPayload.exp;
        access_token = this.jwt.sign(novoPayload, { expiresIn: this.portariaJwtExpiresIn });
      }
      return { success: true, message: 'Senha atualizada com sucesso.', ...(access_token ? { access_token } : {}) };
    }

    // Só o token do porteiro do console declara sub = Funcionarios_Portaria.id. Token 'Funcionario' (QR do
    // app) ou de morador tem sub = Users.id — outra numeração: tratá-lo como porteiro trocava a senha de
    // OUTRO porteiro. A senha dessas contas é a do app e se troca por lá.
    if (sessao?.tipo_sub !== 'funcionario_portaria') {
      throw new ForbiddenException('Esta sessão não troca senha aqui. Altere a senha pelo aplicativo.');
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
      throw new BadRequestException('Senha atual incorreta.');
    }

    const newHash = await bcrypt.hash(novaSenha, 12);
    await this.prisma.funcionarios_Portaria.update({
      where: { id },
      data: { password: newHash },
    });

    // A senha nova muda o carimbo da credencial: as sessões abertas com a anterior caem (JwtStrategy). Esta, que
    // fez a troca, recebe um token novo com o mesmo escopo, como no síndico.
    const novoPayload: any = { ...sessao, cred: carimboCredencialPortaria({ login: funcionario.login, password: newHash }) };
    delete novoPayload.iat;
    delete novoPayload.exp;
    const access_token = this.jwt.sign(novoPayload, { expiresIn: this.portariaJwtExpiresIn });

    return { success: true, message: 'Senha atualizada com sucesso.', access_token };
  }

  async getCondominioNome(id: number, payload: JwtPayload | undefined) {
    // Era público: com id sequencial, listava todos os clientes da plataforma.
    // Exige a sessão e o vínculo — assertCondominio libera quando não há payload.
    if (!payload) throw new UnauthorizedException('Sessão necessária.');
    if (!this.tenant) throw new ForbiddenException('Não foi possível validar o vínculo.');
    await this.tenant.assertCondominio(id, payload);
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
   * Sindicos_Condominios. Funcionário/morador do app: via Funcionarios.
   *
   * Confirma o vínculo e devolve o papel REAL, resolvido no banco (não o que
   * veio no token). Quem chama usa isso para carimbar o typeAccess do token de
   * portaria.
   *
   * Não há fallback por Funcionarios_Portaria: `userId` é sempre Users.id
   * (idUsuarioDoToken recusa o token do console), e Funcionarios_Portaria.id é
   * outra numeração — a comparação só casava por coincidência, com o porteiro
   * de outra pessoa.
   */
  private async assertVinculoCondominio(
    userId: number,
    typeAccess: string,
    idCondominio: number,
  ): Promise<'Sindico' | 'Funcionario'> {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    const tipo = (typeAccess ?? '').toLowerCase();

    if (tipo === 'sindico') {
      // condominio.ativo: o mesmo corte do loginPortaria — condomínio desativado no CRM não ganha sessão por QR.
      const vinculo = await this.prisma.sindicos_Condominios.findFirst({
        where: { id_user: userId, id_condominio: idCondominio, condominio: { ativo: 1 } },
        select: { id: true },
      });
      if (!vinculo) {
        throw new UnauthorizedException('Você não tem vínculo com este condomínio.');
      }
      return 'Sindico';
    }

    // Funcionário: vínculo via Funcionarios (id_user).
    const func = await this.prisma.funcionarios.findFirst({
      where: { id_user: userId, id_condominio: idCondominio, condominio: { ativo: 1 } },
      select: { id: true },
    });
    if (func) return 'Funcionario';

    throw new UnauthorizedException('Você não tem vínculo com este condomínio.');
  }

  async createQrSession() {
    const session = await this.qrStore.create();
    return { qrToken: session.qrToken, expiresAt: session.expiresAt };
  }

  /** Condomínios ativos que o síndico administra, no formato da resposta de login. Falha → lista vazia. */
  private async condominiosAtivosDoSindico(idUser: number) {
    try {
      const vinculos = await this.prisma.sindicos_Condominios.findMany({
        where: { id_user: idUser, condominio: { ativo: 1 } },
        include: { condominio: { select: { nome: true } } },
        orderBy: { id: 'asc' },
      });
      return vinculos.map((v: any) => ({ id: v.id_condominio, nome: v.condominio?.nome || 'Condomínio' }));
    } catch (e: any) {
      this.logger.warn(`Lista de condomínios do síndico ${idUser} indisponível no QR: ${e?.message ?? e}`);
      return [];
    }
  }

  async getQrStatus(qrToken: string) {
    const atual = await this.qrStore.get(qrToken);
    if (!atual) {
      return { status: 'expired' };
    }

    if (atual.status === 'confirmed') {
      // Uma entrega só: o navegador que gerou o QR consulta a cada 1,5 s e é
      // quem recebe; uma segunda consulta (QR fotografado/repassado) não leva o token.
      // A remoção é atômica no banco: duas consultas simultâneas (em instâncias
      // diferentes) — só a que apagou leva o token.
      const session = await this.qrStore.consumir(qrToken);
      if (!session) return { status: 'expired' };
      const sindico = session.typeAccess === 'Sindico';
      return {
        status: 'confirmed',
        access_token: session.access_token,
        id: session.idUser,
        nome: session.nome,
        turno: sindico ? 'Síndico' : 'Porteiro (App)',
        id_condominio: session.id_condominio,
        condominio_nome: session.condominio_nome,
        // Como no login por senha: o síndico que entra pelo QR ganha o seletor de condomínio (campo novo).
        condominios: sindico && session.idUser ? await this.condominiosAtivosDoSindico(Number(session.idUser)) : [],
      };
    }

    return { status: 'pending' };
  }

  async authorizeQrSession(payload: JwtPayload, qrToken: string, idCondominio: number) {
    const session = await this.qrStore.get(qrToken);
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

    // sub só é Users.id em token de USUÁRIO (Sindico/Morador/Funcionario). O token do porteiro do console
    // tem sub = Funcionarios_Portaria.id e o do CRM, crm_admins.id: tratá-los como Users.id, com default
    // 'Sindico', fazia um número coincidente emitir token de síndico de outro condomínio.
    const userId = idUsuarioDoToken(payload);
    if (!userId) {
      throw new UnauthorizedException('Sessão inválida para autorizar o QR Code.');
    }
    const typeAccess = (payload.typeAccess ?? payload.user?.typeAccess) as string;

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
      typeAccess: papelReal,
    };

    const accessToken = this.jwt.sign(portariaPayload, { expiresIn: this.portariaJwtExpiresIn });

    const confirmada = await this.qrStore.confirm(qrToken, {
      idUser: userId,
      nome: nomeUsuario,
      typeAccess,
      id_condominio: idCondominio,
      condominio_nome: cond.nome,
      access_token: accessToken,
    });
    // Outra confirmação chegou antes (ou a sessão venceu no meio do caminho).
    if (confirmada === false) {
      throw new UnauthorizedException('Sessão QR Code já processada.');
    }

    // A sessão do console fica emitida aqui (o navegador só a retira em qr/status).
    this.auditarLogin(
      'LOGIN',
      idCondominio,
      {
        id: userId,
        tipo: 'user',
        nome: nomeUsuario ?? payload.user?.nome ?? payload.user?.name,
        email: payload.email ?? payload.user?.email,
      },
      { metodo: 'qr' },
    );

    return { success: true };
  }
}

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../common/mail/mail.service';
import { EstadoCompartilhado } from '../common/estado-compartilhado';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { mascararLogin } from '../auth/mascarar-login.util';
import { PAPEL_OPERADOR_CENTRAL, operadorDoToken } from './operador.util';

/** Mesmo custo do resto da API (login do console, troca de senha). */
const CUSTO_BCRYPT_SENHA = 12;
/** Mesmo custo do código do MfaService. */
const CUSTO_BCRYPT_CODIGO = 10;
const VALIDADE_DESAFIO_MS = 10 * 60 * 1000;
const MAX_TENTATIVAS = 5;
/** Senhas erradas por e-mail antes de travar o login da central (além do throttle por IP). */
const MAX_FALHAS_SENHA = 8;
const JANELA_FALHAS_MS = 15 * 60 * 1000;
const VALIDADE_TOKEN = '12h';
/** Um token de operador enxerga vários condomínios: mínimo maior que o do console (6). */
const SENHA_MINIMA = 10;
const SENHA_MAXIMA = 200;
const EMAIL_MAXIMO = 190;

/** Formato do desafio (crypto.randomUUID, minúsculo). Outro texto nem chega ao estado compartilhado. */
const DESAFIO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/**
 * Hash bcrypt (custo 12) de um texto aleatório descartado: o e-mail inexistente também paga um
 * bcrypt.compare, e o tempo de resposta não revela se o operador existe.
 */
const HASH_FICTICIO = '$2b$12$qihNJzGjDBWLiRD34pRQFOiDX3oFA.N.l1w1FkdsRIc0EVCZnGUDW';

const MSG_LOGIN_RECUSADO = 'E-mail ou senha incorretos.';
const MSG_CODIGO_EXPIRADO = 'Código expirado ou inválido. Faça login novamente.';
const MSG_CODIGO_ESGOTADO = 'Muitas tentativas incorretas. O código foi invalidado por segurança. Faça login novamente.';
const MSG_SESSAO_ENCERRADA = 'Sessão da central encerrada. Entre novamente.';

/** O que fica guardado entre a senha e o código. O código em si nunca é guardado, só o hash. */
interface DesafioPendente {
  id: number;
  cred: string;
  hash: string;
}

/** Chave da trava de senhas erradas: hash do e-mail, sem o e-mail em claro no estado compartilhado. */
function chaveFalhasDoEmail(emailNormal: string): string {
  return `central-falha:${crypto.createHash('sha256').update(emailNormal).digest('hex')}`;
}

/** Carimbo da credencial do operador: troca ao mudar a senha e ao desativar/reativar (derruba os tokens). */
export function novoCredOperador(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Login do operador da central de portaria. Senha (bcrypt) e depois código de 6 dígitos por e-mail,
 * guardado no estado compartilhado (`mfa-central:<desafio>`) para funcionar com as 2 instâncias da API.
 * Não usa o MfaService: os desafios dele são presos a Users.id, e o operador vive em
 * Central_Operadores.
 *
 * Chaves no estado compartilhado:
 *  - `mfa-central:<desafio>` → { id, cred, hash do código } (10 min)
 *  - `mfa-central-tent:<desafio>` → tentativas de código usadas (teto 5, reservadas antes de conferir)
 *  - `mfa-central-atual:<id>` → o único desafio válido do operador (novo login invalida o anterior)
 *  - `central-falha:<sha256 do e-mail>` → senhas erradas (login e troca de senha) na janela de 15 min (teto 8)
 */
@Injectable()
export class CentralAuthService {
  private readonly logger = new Logger(CentralAuthService.name);
  private readonly estado: EstadoCompartilhado;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
  ) {
    this.estado = new EstadoCompartilhado(prisma);
  }

  async login(email: unknown, senha: unknown): Promise<{ desafio: string; email_mascarado: string }> {
    // Corpo sem DTO: objeto no e-mail viraria filtro do Prisma. Mesmo 401 genérico de senha errada.
    if (
      typeof email !== 'string' ||
      typeof senha !== 'string' ||
      !email.trim() ||
      !senha ||
      email.length > EMAIL_MAXIMO ||
      senha.length > SENHA_MAXIMA
    ) {
      throw new UnauthorizedException(MSG_LOGIN_RECUSADO);
    }
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    const emailNormal = email.trim().toLowerCase();
    const chaveFalhas = chaveFalhasDoEmail(emailNormal);
    await this.assertNaoTravado(chaveFalhas);

    const op = await this.prisma.central_Operadores.findUnique({ where: { email: emailNormal } });
    const senhaConfere = await this.compararSenha(senha, op?.senha_hash || HASH_FICTICIO);
    if (!op || op.ativo !== 1 || !senhaConfere) {
      await this.estado.incrementarSeAbaixo(chaveFalhas, MAX_FALHAS_SENHA, JANELA_FALHAS_MS);
      this.logger.warn(`Login da central recusado para ${mascararLogin(emailNormal)}`);
      throw new UnauthorizedException(MSG_LOGIN_RECUSADO);
    }
    await this.estado.remover(chaveFalhas);

    const cred = await this.garantirCred(op.id, op.cred);

    const codigo = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const desafio = crypto.randomUUID();
    const hash = await bcrypt.hash(codigo, CUSTO_BCRYPT_CODIGO);

    // Um desafio por operador: quem tem a senha não abre vários em paralelo para multiplicar as 5 tentativas.
    const chaveAtual = `mfa-central-atual:${op.id}`;
    const anterior = (await this.estado.obter<string>(chaveAtual))?.valor;
    if (anterior) await this.limparDesafio(anterior);
    await this.estado.definir<DesafioPendente>(`mfa-central:${desafio}`, { id: op.id, cred, hash }, VALIDADE_DESAFIO_MS);
    await this.estado.definir(chaveAtual, desafio, VALIDADE_DESAFIO_MS);

    try {
      await this.mail.sendCodigoCentral(op.email, op.nome, codigo);
    } catch (err: any) {
      this.logger.error(`Falha ao enviar o código da central para ${mascararLogin(op.email)}: ${err?.message ?? err}`);
      await this.limparDesafio(desafio);
      await this.estado.remover(chaveAtual);
      throw new ServiceUnavailableException('Não foi possível enviar o código agora. Tente novamente em instantes.');
    }

    return { desafio, email_mascarado: mascararLogin(op.email) };
  }

  async verificar(
    desafio: unknown,
    codigo: unknown,
  ): Promise<{ access_token: string; nome: string; trocar_senha: boolean }> {
    if (typeof desafio !== 'string' || typeof codigo !== 'string') {
      throw new BadRequestException('Informe o código recebido por e-mail.');
    }
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }
    if (!DESAFIO_RE.test(desafio)) throw new UnauthorizedException(MSG_CODIGO_EXPIRADO);

    const chave = `mfa-central:${desafio}`;
    const entrada = await this.estado.obter<DesafioPendente>(chave);
    const pendente = entrada?.valor;
    if (!entrada || !pendente) throw new UnauthorizedException(MSG_CODIGO_EXPIRADO);

    const chaveAtual = `mfa-central-atual:${pendente.id}`;
    if ((await this.estado.obter<string>(chaveAtual))?.valor !== desafio) {
      await this.limparDesafio(desafio);
      throw new UnauthorizedException(MSG_CODIGO_EXPIRADO);
    }

    // Reserva a tentativa ANTES de conferir (atômico entre instâncias): requisições paralelas não
    // testam mais de 5 códigos no mesmo desafio.
    const chaveTentativas = `mfa-central-tent:${desafio}`;
    const restanteMs = Math.max(1000, entrada.expiraEm.getTime() - Date.now());
    if (!(await this.estado.incrementarSeAbaixo(chaveTentativas, MAX_TENTATIVAS, restanteMs))) {
      await this.limparDesafio(desafio);
      throw new HttpException(MSG_CODIGO_ESGOTADO, HttpStatus.TOO_MANY_REQUESTS);
    }

    const limpo = codigo.trim();
    const confere = /^\d{6}$/.test(limpo) && (await bcrypt.compare(limpo, pendente.hash));
    if (!confere) {
      const usadas = Number((await this.estado.obter<number>(chaveTentativas))?.valor) || MAX_TENTATIVAS;
      const restam = Math.max(0, MAX_TENTATIVAS - usadas);
      if (restam === 0) {
        await this.limparDesafio(desafio);
        throw new HttpException(MSG_CODIGO_ESGOTADO, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw new UnauthorizedException(`Código incorreto. Restam ${restam} tentativa(s).`);
    }

    // Consome de forma exclusiva: só um chamador emite token.
    if (!(await this.estado.consumirUmaVez<DesafioPendente>(chave))) {
      throw new UnauthorizedException(MSG_CODIGO_EXPIRADO);
    }
    await this.estado.remover(chaveTentativas);
    if ((await this.estado.obter<string>(chaveAtual))?.valor === desafio) await this.estado.remover(chaveAtual);

    // Desativado ou com a senha trocada entre a senha e o código: o carimbo mudou, não entra.
    const op = await this.prisma.central_Operadores.findUnique({ where: { id: pendente.id } });
    if (!op || op.ativo !== 1 || !op.cred || op.cred !== pendente.cred) {
      throw new UnauthorizedException(MSG_SESSAO_ENCERRADA);
    }

    await this.prisma.central_Operadores
      .update({ where: { id: op.id }, data: { ultimo_acesso: new Date() } })
      .catch((e: any) => this.logger.warn(`Não foi possível gravar o último acesso do operador ${op.id}: ${e?.message ?? e}`));

    return {
      access_token: this.assinar(op.id, op.nome, op.cred, op.trocar_senha === 1),
      nome: op.nome,
      trocar_senha: op.trocar_senha === 1,
    };
  }

  /**
   * Troca a senha do próprio operador. Zera `trocar_senha` e troca o `cred`: as outras sessões abertas
   * caem (JwtStrategy, em até 30 s pelo cache); esta recebe um token novo.
   */
  async trocarSenha(
    user: JwtPayload,
    senhaAtual: unknown,
    senhaNova: unknown,
  ): Promise<{ access_token: string; nome: string; trocar_senha: false }> {
    // Única rota que aceita o token marcado com trocar_senha.
    const { uid } = operadorDoToken(user, { permitirTrocaDeSenha: true });
    if (typeof senhaAtual !== 'string' || !senhaAtual) {
      throw new BadRequestException('Informe a senha atual.');
    }
    if (typeof senhaNova !== 'string' || senhaNova.length < SENHA_MINIMA || senhaNova.length > SENHA_MAXIMA) {
      throw new BadRequestException(`A nova senha deve ter no mínimo ${SENHA_MINIMA} caracteres.`);
    }
    if (senhaNova === senhaAtual) {
      throw new BadRequestException('A nova senha precisa ser diferente da atual.');
    }
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    const op = await this.prisma.central_Operadores.findUnique({ where: { id: uid } });
    if (!op || op.ativo !== 1 || !op.cred || op.cred !== user.cred) {
      throw new UnauthorizedException(MSG_SESSAO_ENCERRADA);
    }
    // Senha atual errada conta na mesma trava do login (por e-mail): quem tem só o token não testa
    // senhas à vontade. 400, como no change-password do console: 401 o console trata como fim de sessão.
    const chaveFalhas = chaveFalhasDoEmail(String(op.email ?? '').trim().toLowerCase());
    await this.assertNaoTravado(chaveFalhas);
    if (!(await this.compararSenha(senhaAtual, op.senha_hash))) {
      await this.estado.incrementarSeAbaixo(chaveFalhas, MAX_FALHAS_SENHA, JANELA_FALHAS_MS);
      this.logger.warn(`Troca de senha da central com senha atual errada (operador ${uid})`);
      throw new BadRequestException('Senha atual incorreta.');
    }
    await this.estado.remover(chaveFalhas);

    const senha_hash = await bcrypt.hash(senhaNova, CUSTO_BCRYPT_SENHA);
    const cred = novoCredOperador();
    // Condicional ao carimbo lido: duas trocas simultâneas não deixam as duas valerem.
    const r = await this.prisma.central_Operadores.updateMany({
      where: { id: uid, ativo: 1, cred: op.cred },
      data: { senha_hash, trocar_senha: 0, cred },
    });
    if (Number(r?.count ?? 0) !== 1) throw new UnauthorizedException(MSG_SESSAO_ENCERRADA);

    return { access_token: this.assinar(uid, op.nome, cred), nome: op.nome, trocar_senha: false };
  }

  /** `trocarSenha`: a marca vai no token e o operadorDoToken recusa tudo menos a rota de troca. */
  private assinar(id: number, nome: string, cred: string, trocarSenha = false): string {
    const payload: JwtPayload = {
      sub: id,
      nome,
      papel: PAPEL_OPERADOR_CENTRAL,
      cred,
      ...(trocarSenha ? { trocar_senha: true } : {}),
    };
    return this.jwt.sign(payload, { expiresIn: VALIDADE_TOKEN });
  }

  private async assertNaoTravado(chaveFalhas: string): Promise<void> {
    const falhas = Number((await this.estado.obter<number>(chaveFalhas))?.valor) || 0;
    if (falhas >= MAX_FALHAS_SENHA) {
      throw new HttpException(
        'Muitas tentativas com senha errada. Aguarde alguns minutos e tente novamente.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Hash ausente ou fora do formato bcrypt nunca confere (em vez de estourar 500). */
  private async compararSenha(senha: string, hash: string): Promise<boolean> {
    if (typeof hash !== 'string' || !hash.startsWith('$2')) {
      await bcrypt.compare(senha, HASH_FICTICIO).catch(() => false);
      return false;
    }
    try {
      return await bcrypt.compare(senha, hash);
    } catch {
      return false;
    }
  }

  /**
   * Operador sem carimbo (linha criada sem `cred`) ganha um antes do primeiro token: token sem `cred`
   * a JwtStrategy recusa. Condicional a `cred = ''` para duas instâncias não gravarem carimbos diferentes.
   */
  private async garantirCred(id: number, atual: string): Promise<string> {
    if (atual) return atual;
    const cred = novoCredOperador();
    const r = await this.prisma.central_Operadores.updateMany({ where: { id, cred: '' }, data: { cred } });
    if (Number(r?.count ?? 0) === 1) return cred;
    const relido = await this.prisma.central_Operadores.findUnique({ where: { id }, select: { cred: true } });
    if (!relido?.cred) throw new UnauthorizedException(MSG_LOGIN_RECUSADO);
    return relido.cred;
  }

  private async limparDesafio(desafio: string): Promise<void> {
    await this.estado.remover(`mfa-central:${desafio}`);
    await this.estado.remover(`mfa-central-tent:${desafio}`);
  }
}

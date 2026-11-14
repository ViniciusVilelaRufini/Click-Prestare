import { Logger } from '@nestjs/common';
import * as http2 from 'node:http2';
import type { SecureClientSessionOptions } from 'node:http2';
import type { RespostaApns } from '../card-ao-vivo/apns.client';
import type { ChavesApple } from './wallet.constantes';

export type { RespostaApns } from '../card-ao-vivo/apns.client';
export { tokenMorto } from '../card-ao-vivo/apns.client';

/**
 * O aviso de atualização de passe só funciona no APNs de produção (Apple,
 * "Adding a Web Service to Update Passes"). Fixo de propósito: não segue
 * APNS_HOST, que o card ao vivo pode apontar para o sandbox.
 */
export const APNS_HOST_PASSES = 'https://api.push.apple.com';

/** Token do APNs: hexadecimal. Vai no caminho do pedido; nada além disso sai. */
const PUSH_TOKEN = /^[0-9A-Fa-f]{16,200}$/;
/** Validade do aviso: alcança o aparelho que ficou um dia sem internet. */
const VALIDADE_AVISO_S = 86_400;

export interface OpcoesPush {
  /** Só para teste: CA e conferência de nome do servidor local. */
  tls?: Pick<SecureClientSessionOptions, 'ca' | 'checkServerIdentity'>;
  timeoutMs?: number;
}

/**
 * Aviso de atualização do passe da Apple Wallet por APNs, autenticado pelo
 * CERTIFICADO do Pass Type ID (o mesmo que assina o passe), sem JWT. Corpo
 * `{}`: o aparelho então pergunta ao serviço de atualização o que mudou.
 *
 * Cabeçalhos: `apns-push-type: background`, `apns-priority: 5` e
 * `apns-expiration` de um dia. Sem `apns-topic`: com certificado só de
 * PassKit/Wallet o tópico é o do próprio certificado, e a Apple orienta a
 * omiti-lo (fórum de desenvolvedores, resposta do DTS sobre TopicDisallowed).
 *
 * HTTP/2, timeout e "uma resolução só" seguem o `ApnsClient` do card ao vivo.
 * Nunca rejeita e nunca loga o token nem a chave.
 */
export class ApplePassPushClient {
  private readonly logger = new Logger(ApplePassPushClient.name);
  private sessao: http2.ClientHttp2Session | null = null;
  /** Certificado com que a sessão atual foi aberta: trocou no S3, abre outra. */
  private certDaSessao: string | null = null;
  private readonly timeoutMs: number;

  constructor(
    private readonly chaves: () => Promise<ChavesApple | null>,
    private readonly host: string = APNS_HOST_PASSES,
    private readonly opcoes: OpcoesPush = {},
  ) {
    this.timeoutMs = opcoes.timeoutMs ?? 8_000;
  }

  async avisar(pushToken: string): Promise<RespostaApns> {
    if (typeof pushToken !== 'string' || !PUSH_TOKEN.test(pushToken)) return { status: 0, motivo: 'token-invalido' };
    let chaves: ChavesApple | null = null;
    try {
      chaves = await this.chaves();
    } catch {
      chaves = null;
    }
    if (!chaves) return { status: 0, motivo: 'sem-chave' };

    try {
      const r = await this.post(pushToken, chaves);
      // Timeout não repete; stream fechado sem resposta (sessão caída) repete abaixo.
      if (r.status !== 0 || r.motivo === 'timeout') return r;
      this.fecharSessao();
    } catch {
      this.fecharSessao();
    }
    try {
      const r = await this.post(pushToken, chaves);
      if (r.status === 0 && r.motivo !== 'timeout') return { status: 0, motivo: 'rede' };
      return r;
    } catch (e: any) {
      this.fecharSessao();
      this.logger.warn(`APNs (passes) indisponível: ${e?.code ?? e?.name ?? 'erro'}`);
      return { status: 0, motivo: 'rede' };
    }
  }

  fecharSessao() {
    try {
      this.sessao?.close();
    } catch {
      /* já fechada */
    }
    this.sessao = null;
    this.certDaSessao = null;
  }

  private obterSessao(chaves: ChavesApple): http2.ClientHttp2Session {
    if (this.sessao && !this.sessao.closed && !this.sessao.destroyed && this.certDaSessao === chaves.certPem) {
      return this.sessao;
    }
    this.fecharSessao();
    const s = http2.connect(this.host, { cert: chaves.certPem, key: chaves.chavePem, ...(this.opcoes.tls ?? {}) });
    s.on('error', () => {
      if (this.sessao === s) this.fecharSessao();
    });
    s.on('goaway', () => {
      if (this.sessao === s) this.fecharSessao();
    });
    // Não segura o processo vivo (testes, shutdown).
    s.unref();
    this.sessao = s;
    this.certDaSessao = chaves.certPem;
    return s;
  }

  private post(pushToken: string, chaves: ChavesApple): Promise<RespostaApns> {
    return new Promise((resolveOriginal, reject) => {
      // Toda saída passa por aqui uma vez só (ver ApnsClient.post): um stream
      // cancelado pelo timeout não emite 'error' nem 'end'.
      let terminou = false;
      const resolve = (r: RespostaApns) => {
        if (terminou) return;
        terminou = true;
        resolveOriginal(r);
      };
      let req: http2.ClientHttp2Stream;
      try {
        req = this.obterSessao(chaves).request({
          ':method': 'POST',
          ':path': `/3/device/${pushToken}`,
          'apns-push-type': 'background',
          'apns-priority': '5',
          'apns-expiration': String(Math.floor(Date.now() / 1000) + VALIDADE_AVISO_S),
          'content-type': 'application/json',
        });
      } catch (e) {
        reject(e);
        return;
      }
      req.setTimeout(this.timeoutMs, () => {
        resolve({ status: 0, motivo: 'timeout' });
        req.close(http2.constants.NGHTTP2_CANCEL);
      });
      let status = 0;
      let dados = '';
      req.on('response', (h) => {
        status = Number(h[':status']) || 0;
      });
      req.setEncoding('utf8');
      req.on('data', (c) => (dados += c));
      req.on('end', () => {
        let motivo: string | undefined;
        if (dados) {
          try {
            motivo = JSON.parse(dados)?.reason;
          } catch {
            motivo = undefined;
          }
        }
        resolve({ status, ...(typeof motivo === 'string' ? { motivo: motivo.slice(0, 60) } : {}) });
      });
      req.on('close', () => resolve({ status, ...(status ? {} : { motivo: 'fechado' }) }));
      req.on('error', (e) => {
        if (terminou) return;
        terminou = true;
        reject(e);
      });
      req.end('{}');
    });
  }
}

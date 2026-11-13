import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as http2 from 'http2';

/**
 * Cliente mínimo do APNs para Live Activity (push-to-start, update, end).
 *
 * Por que não o FCM: o push comum do Firebase não abre Live Activity com o app
 * fechado de forma confiável. Por que não uma biblioteca: são ~100 linhas de
 * HTTP/2 + JWT ES256, que o Node já tem.
 *
 * A chave (.p8) é a "push" da conta Apple (Key ID abaixo), team-scoped, a
 * mesma que o Firebase usa — não é segredo novo. Fica no S3 privado
 * (`config/apns/AuthKey.p8`) porque as variáveis do Elastic Beanstalk estão no
 * limite de 4096 caracteres. Key ID e Team ID não são segredo.
 */
export const APNS_KEY_ID = process.env['APNS_KEY_ID'] || 'V76D4R22A2';
export const APNS_TEAM_ID = process.env['APNS_TEAM_ID'] || '9FD7V97G5V';
export const APNS_BUNDLE_ID = 'br.com.clickprestare.app';
export const APNS_TOPICO_LIVE_ACTIVITY = `${APNS_BUNDLE_ID}.push-type.liveactivity`;
/** Builds do TestFlight/App Store usam o APNs de produção. */
export const APNS_HOST = process.env['APNS_HOST'] || 'https://api.push.apple.com';

/** O APNs recusa JWT com mais de 1 h e limita a troca a 1 a cada 20 min. */
const VALIDADE_JWT_MS = 50 * 60 * 1000;

export interface RespostaApns {
  /** HTTP do APNs; 0 = não enviou (sem chave, erro de rede). */
  status: number;
  motivo?: string;
}

export type CarregarChave = () => Promise<string | null>;

function base64url(entrada: Buffer | string): string {
  return Buffer.from(entrada).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** JWT ES256 do APNs. Exportado para teste. */
export function assinarJwtApns(chavePem: string, keyId: string, teamId: string, agoraSeg: number): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: agoraSeg }));
  const assinatura = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: chavePem,
    // O APNs quer a assinatura crua (r||s, 64 bytes), não DER.
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${claims}.${base64url(assinatura)}`;
}

export class ApnsClient {
  private readonly logger = new Logger(ApnsClient.name);
  private chave: string | null | undefined;
  private jwt: { valor: string; criadoEm: number } | null = null;
  private sessao: http2.ClientHttp2Session | null = null;
  private avisouSemChave = false;
  private proximaTentativaChave = 0;

  constructor(
    private readonly carregarChave: CarregarChave,
    private readonly host: string = APNS_HOST,
  ) {}

  async enviar(token: string, corpo: object, prioridade: 5 | 10): Promise<RespostaApns> {
    const jwt = await this.obterJwt();
    if (!jwt) return { status: 0, motivo: 'sem-chave' };
    try {
      const r = await this.post(token, JSON.stringify(corpo), prioridade, jwt);
      // Timeout: não repete (o tempo do porteiro já foi gasto); a reserva cobre.
      return r;
    } catch (e: any) {
      // Sessão HTTP/2 caída (GOAWAY, rede): descarta e tenta uma vez numa nova.
      this.fecharSessao();
      try {
        return await this.post(token, JSON.stringify(corpo), prioridade, jwt);
      } catch (e2: any) {
        this.logger.warn(`APNs indisponível: ${e2?.message ?? e2}`);
        return { status: 0, motivo: 'rede' };
      }
    }
  }

  private async obterJwt(): Promise<string | null> {
    if (this.chave === undefined && Date.now() >= this.proximaTentativaChave) {
      try {
        this.chave = (await this.carregarChave()) || null;
      } catch (e: any) {
        this.logger.warn(`Chave do APNs não carregou: ${e?.message ?? e}`);
        this.chave = null;
      }
    }
    if (!this.chave) {
      if (!this.avisouSemChave) {
        this.avisouSemChave = true;
        this.logger.warn('Card ao vivo (iPhone) desativado: chave do APNs ausente. Aparelhos recebem o push comum.');
      }
      // Tenta de novo em 5 min: a chave pode ser publicada depois, mas buscar
      // no S3 a cada push seria desperdício.
      if (this.chave === null) this.proximaTentativaChave = Date.now() + 5 * 60 * 1000;
      this.chave = undefined;
      return null;
    }
    const agora = Date.now();
    if (!this.jwt || agora - this.jwt.criadoEm > VALIDADE_JWT_MS) {
      this.jwt = {
        valor: assinarJwtApns(this.chave, APNS_KEY_ID, APNS_TEAM_ID, Math.floor(agora / 1000)),
        criadoEm: agora,
      };
    }
    return this.jwt.valor;
  }

  private obterSessao(): http2.ClientHttp2Session {
    if (this.sessao && !this.sessao.closed && !this.sessao.destroyed) return this.sessao;
    const s = http2.connect(this.host);
    s.on('error', () => this.fecharSessao());
    s.on('goaway', () => this.fecharSessao());
    // Não segura o processo vivo (testes, shutdown).
    s.unref();
    this.sessao = s;
    return s;
  }

  private fecharSessao() {
    try {
      this.sessao?.close();
    } catch {
      /* já fechada */
    }
    this.sessao = null;
  }

  private post(token: string, corpo: string, prioridade: 5 | 10, jwt: string): Promise<RespostaApns> {
    return new Promise((resolveOriginal, reject) => {
      // Toda saída passa por aqui uma vez só. Um stream cancelado pelo timeout
      // (RST_STREAM CANCEL) não emite 'error' nem 'end' no Node: sem o
      // 'close' e o resolve do timeout, a promessa ficaria pendurada e
      // travaria o pedido do porteiro e o tique.
      let terminou = false;
      const resolve = (r: RespostaApns) => {
        if (terminou) return;
        terminou = true;
        resolveOriginal(r);
      };
      const req = this.obterSessao().request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${jwt}`,
        'apns-push-type': 'liveactivity',
        'apns-topic': APNS_TOPICO_LIVE_ACTIVITY,
        'apns-priority': String(prioridade),
        'content-type': 'application/json',
      });
      req.setTimeout(8_000, () => {
        resolve({ status: 0, motivo: 'timeout' });
        req.close(http2.constants.NGHTTP2_CANCEL);
      });
      req.on('close', () => resolve({ status, motivo: status ? undefined : 'fechado' }));
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
            motivo = dados.slice(0, 100);
          }
        }
        resolve({ status, ...(motivo ? { motivo } : {}) });
      });
      req.on('error', (e) => {
        if (terminou) return;
        terminou = true;
        reject(e);
      });
      req.end(corpo);
    });
  }
}

/** Token que o APNs diz não existir mais: sai do aparelho. */
export function tokenMorto(r: RespostaApns): boolean {
  return r.status === 410 || (r.status === 400 && (r.motivo === 'BadDeviceToken' || r.motivo === 'Unregistered'));
}

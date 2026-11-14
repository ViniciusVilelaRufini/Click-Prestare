import { Injectable, Logger } from '@nestjs/common';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { StorageService } from '../common/storage/storage.service';
import { CHAVES_S3, ChavesApple, PASS_TYPE_ID } from './wallet.constantes';

export { CHAVES_S3, PASS_TYPE_ID, APPLE_TEAM_ID } from './wallet.constantes';
export type { ChavesApple } from './wallet.constantes';

/** Sem as chaves, nova tentativa no S3 só depois disto. */
const ESPERA_AUSENTE_MS = 5 * 60 * 1000;
/** Com as chaves, relê depois disto (renovação do certificado sem reinício). */
const VALIDADE_MEMORIA_MS = 60 * 60 * 1000;

/**
 * Chave e certificados do passe da Apple, lidos do S3 privado pelo papel que a
 * API já tem. Mesmo comportamento da chave do APNs (`ApnsClient.obterJwt`):
 * sem os arquivos, devolve null e só tenta de novo em 5 minutos.
 *
 * Nunca lança e nunca loga conteúdo: só o nome da peça que faltou. Uma peça
 * ilegível, a chave que não é do certificado ou um certificado de outro Pass
 * Type ID contam como ausentes: assinar com eles produziria passe que a
 * Carteira recusa.
 */
@Injectable()
export class WalletChavesService {
  private readonly logger = new Logger(WalletChavesService.name);
  private cache: { chaves: ChavesApple; lidoEm: number } | null = null;
  private proximaTentativa = 0;
  private emAndamento: Promise<ChavesApple | null> | null = null;
  private ultimoAviso = '';

  constructor(private readonly storage: StorageService) {}

  async apple(): Promise<ChavesApple | null> {
    const agora = Date.now();
    if (this.cache && agora - this.cache.lidoEm < VALIDADE_MEMORIA_MS) return this.cache.chaves;
    if (!this.cache && agora < this.proximaTentativa) return null;
    // Uma leitura por vez: chamadas juntas esperam a mesma.
    this.emAndamento ??= this.carregar().finally(() => (this.emAndamento = null));
    return this.emAndamento;
  }

  private async carregar(): Promise<ChavesApple | null> {
    const lidas = await this.ler();
    const agora = Date.now();
    if (lidas) {
      this.cache = { chaves: lidas, lidoEm: agora };
      this.ultimoAviso = '';
      return lidas;
    }
    if (this.cache) {
      // Releitura falhou: segue com as anteriores e tenta de novo em 5 min.
      this.cache = { chaves: this.cache.chaves, lidoEm: agora - VALIDADE_MEMORIA_MS + ESPERA_AUSENTE_MS };
      return this.cache.chaves;
    }
    this.proximaTentativa = agora + ESPERA_AUSENTE_MS;
    return null;
  }

  private async ler(): Promise<ChavesApple | null> {
    const pecas = [
      ['chave do passe', CHAVES_S3.applePassKey],
      ['certificado do passe', CHAVES_S3.applePassCert],
      ['intermediário WWDR', CHAVES_S3.appleWwdr],
    ] as const;
    const textos = await Promise.all(
      pecas.map(async ([, key]) => {
        try {
          const t = await this.storage.lerObjetoTexto(key);
          return typeof t === 'string' && t.trim() ? t : null;
        } catch {
          return null;
        }
      }),
    );
    const faltando = pecas.filter((_, i) => !textos[i]).map(([nome]) => nome);
    if (faltando.length) return this.ausente(`faltam no S3: ${faltando.join(', ')}`);
    const [chavePem, certPem, wwdrPem] = textos as string[];

    try {
      const cert = new X509Certificate(certPem);
      new X509Certificate(wwdrPem);
      if (!cert.checkPrivateKey(createPrivateKey(chavePem))) {
        return this.ausente('a chave do passe não é a do certificado');
      }
      if (!cert.subject.includes(PASS_TYPE_ID)) {
        return this.ausente('o certificado não é do Pass Type ID do passe');
      }
      if (Date.parse(cert.validTo) < Date.now()) {
        this.avisar('certificado do passe vencido: a Carteira vai recusar os passes até a troca');
      }
    } catch {
      return this.ausente('chave ou certificado ilegível');
    }
    return { chavePem, certPem, wwdrPem };
  }

  private ausente(motivo: string): null {
    this.avisar(`Passe na carteira (Apple) indisponível: ${motivo}.`);
    return null;
  }

  /** Um aviso por motivo enquanto ele persistir (não inunda o log a cada 5 min). */
  private avisar(texto: string) {
    if (texto === this.ultimoAviso) return;
    this.ultimoAviso = texto;
    this.logger.warn(texto);
  }
}

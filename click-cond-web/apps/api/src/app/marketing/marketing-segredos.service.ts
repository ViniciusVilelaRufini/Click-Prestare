import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret } from '../facial/device-secret.util';

export type SegredoMarketing = 'ADS_INGEST_TOKEN' | 'OPENAI_ADS_API_KEY';

const CACHE_MS = 5 * 60 * 1000;

/**
 * Credenciais do marketing. A env do Elastic Beanstalk está no limite de 4096
 * caracteres (o JSON do Firebase ocupa ~3,2 mil), e passar do limite faz o
 * update falhar em silêncio — por isso as chaves podem morar em crm_config,
 * cifradas com encryptSecret (mesma chave do JWT_SECRET). A env, se existir,
 * tem precedência.
 */
@Injectable()
export class MarketingSegredosService {
  private cache = new Map<SegredoMarketing, { valor: string | undefined; ate: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async obter(nome: SegredoMarketing): Promise<string | undefined> {
    const env = process.env[nome];
    if (env) return env;
    const c = this.cache.get(nome);
    if (c && c.ate > Date.now()) return c.valor;
    const row = await this.prisma.crm_Config.findUnique({ where: { chave: nome } });
    const valor = decryptSecret(row?.valor ?? null) || undefined;
    // Valor ainda cifrado depois de decryptSecret = chave do servidor não bate; tratar como ausente.
    const util = valor && !valor.startsWith('enc:v1:') ? valor : undefined;
    this.cache.set(nome, { valor: util, ate: Date.now() + CACHE_MS });
    return util;
  }
}

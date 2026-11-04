import { Injectable } from '@nestjs/common';
import { BedrockClient } from './bedrock.client';
import { GeminiClient } from './gemini.client';
import type { ConteudoGemini, DeclaracaoFerramenta, RespostaGemini } from './gemini.client';
import { limiteExterno } from '../common/limitar-concorrencia';

/**
 * Bulkhead do provedor de IA (Bedrock ou Gemini): máx. 8 chamadas em voo por
 * instância, fila curta e 503 claro quando saturar (LIMITES_EXTERNOS.ia).
 * Chamadas de IA duram dezenas de segundos — sem teto, um pico no chat prende
 * memória e sockets e atrasa o resto da API.
 */
const limitarIa = limiteExterno('ia');

/**
 * Provedor do Assistente IA, escolhido por IA_PROVEDOR (`bedrock` | `gemini`).
 *
 * Produção roda em `bedrock`: o produto é declarado no AWS Marketplace como
 * hospedado inteiramente na AWS, condição do selo AWS Qualified Software.
 * Voltar para `gemini` é contingência — enquanto durar, essa declaração deixa
 * de ser verdadeira e precisa ser atualizada no Marketplace.
 *
 * Cada provedor gera embeddings incompatíveis com o outro (dimensões
 * diferentes): depois de trocar, reindexe os documentos (POST
 * /chat-ia/reindex) — até lá a busca ignora os vetores do provedor antigo.
 */
@Injectable()
export class IaClient {
  constructor(
    private readonly bedrock: BedrockClient,
    private readonly gemini: GeminiClient,
  ) {}

  private get provedor(): BedrockClient | GeminiClient {
    return (process.env['IA_PROVEDOR'] || 'bedrock').toLowerCase() === 'gemini' ? this.gemini : this.bedrock;
  }

  get isConfigured(): boolean {
    return this.provedor.isConfigured;
  }

  embedText(texto: string): Promise<number[]> {
    return limitarIa(() => this.provedor.embedText(texto));
  }

  embedBatch(textos: string[]): Promise<number[][]> {
    return limitarIa(() => this.provedor.embedBatch(textos));
  }

  gerarComFerramentas(
    contents: ConteudoGemini[],
    ferramentas: DeclaracaoFerramenta[],
    instrucaoSistema?: string,
  ): Promise<RespostaGemini> {
    return limitarIa(() => this.provedor.gerarComFerramentas(contents, ferramentas, instrucaoSistema));
  }
}

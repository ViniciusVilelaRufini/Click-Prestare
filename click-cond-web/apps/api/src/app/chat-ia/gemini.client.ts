import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/**
 * Wrapper fino da API REST do Google Gemini para o Assistente IA.
 *
 * Usa o `fetch` nativo do Node — sem SDK. A chave vem de GEMINI_API_KEY e
 * NUNCA vai para o app: o Flutter só fala com este backend.
 *
 *  - gemini-embedding-2 → embeddings do RAG de atas/documentos
 *  - gemini-3.6-flash   → geração da resposta final
 *
 * O Google aposenta modelo com data marcada e a chamada passa a devolver 404:
 * `text-embedding-004` morreu em 14/01/2026 e `gemini-2.0-flash` em 01/06/2026.
 * Por isso os nomes são sobrescrevíveis por env — na próxima aposentadoria dá
 * para trocar pela variável no Railway, sem esperar deploy.
 */
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const EMBED_MODEL = process.env['GEMINI_EMBED_MODEL'] || 'gemini-embedding-2';
const GEN_MODEL = process.env['GEMINI_GEN_MODEL'] || 'gemini-3.6-flash';

/**
 * O gemini-embedding-2 devolve 3072 dimensões por padrão. Pedimos 768: o
 * ranking é feito em memória percorrendo todos os trechos do condomínio, então
 * vetor 4x menor é 4x menos storage e 4x menos conta por pergunta. O Google
 * documenta 768 como tamanho recomendado de truncamento, sem perda relevante.
 *
 * Truncar desnormaliza o vetor, mas o cosseno divide pelas magnitudes — o
 * score não muda por causa disso.
 */
const EMBED_DIMS = 768;

/**
 * 1024 cortava resposta no meio: uma pergunta sobre visitas do apartamento
 * terminou em "...saída 04/07/2026, 15:52:57  11. TESTE SINCRON". Com
 * ferramentas o modelo ainda pode receber listas, então o teto subiu.
 */
const MAX_OUTPUT_TOKENS = 4096;

/**
 * Declaração de ferramenta no formato functionDeclarations do generateContent.
 *
 * `parameters` é OPCIONAL e precisa ser OMITIDO quando a função não tem
 * argumento. O Gemini valida que todo schema OBJECT tenha `properties`
 * não-vazio e responde 400 com
 * "function_declarations[N].parameters.properties: should be non-empty for
 * OBJECT type" — mandar `{ type: 'object', properties: {} }` derruba a
 * requisição inteira, não só aquela ferramenta.
 */
export interface DeclaracaoFerramenta {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ChamadaFerramenta {
  name: string;
  args: Record<string, any>;
}

/** Um turno da conversa no formato do generateContent. */
export interface ConteudoGemini {
  role: 'user' | 'model';
  parts: any[];
}

export interface RespostaGemini {
  /** Texto final. Vazio quando o modelo pediu ferramentas em vez de responder. */
  texto: string;
  /** Ferramentas que o modelo quer executar nesta rodada. */
  chamadas: ChamadaFerramenta[];
  /**
   * As `parts` do turno do modelo, EXATAMENTE como vieram.
   *
   * Precisam ser devolvidas verbatim na próxima rodada. Os modelos Gemini 3.x
   * embutem um `thought_signature` (e um `id`) dentro do functionCall; montar
   * um `{ name, args }` novo perde esses campos e a API responde 400:
   * "Function call is missing a thought_signature in functionCall parts".
   */
  partesModelo: any[];
}

@Injectable()
export class GeminiClient {
  /** true quando a env está configurada — usado para degradar sem quebrar. */
  get isConfigured(): boolean {
    return !!process.env['GEMINI_API_KEY'];
  }

  private getKey(): string {
    const key = process.env['GEMINI_API_KEY'];
    if (!key) {
      throw new ServiceUnavailableException(
        'O assistente não está configurado neste ambiente (GEMINI_API_KEY ausente).',
      );
    }
    return key;
  }

  private async call(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${API_BASE}/${path}?key=${this.getKey()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[Gemini] HTTP ${res.status}: ${text.substring(0, 300)}`);
    }
    return res.json();
  }

  /** Embedding de um texto. Retorna array de floats (EMBED_DIMS). */
  async embedText(texto: string): Promise<number[]> {
    const data = await this.call(`models/${EMBED_MODEL}:embedContent`, {
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: texto }] },
      output_dimensionality: EMBED_DIMS,
    });
    return data?.embedding?.values ?? [];
  }

  /** Embeddings de vários textos numa chamada, na mesma ordem da entrada. */
  async embedBatch(textos: string[]): Promise<number[][]> {
    if (!textos || textos.length === 0) return [];
    const data = await this.call(`models/${EMBED_MODEL}:batchEmbedContents`, {
      requests: textos.map((t) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: t }] },
        output_dimensionality: EMBED_DIMS,
      })),
    });
    return (data?.embeddings ?? []).map((e: any) => e.values);
  }

  /** Resposta final a partir do prompt já montado (contexto + histórico). */
  async gerarResposta(prompt: string): Promise<string> {
    const data = await this.call(`models/${GEN_MODEL}:generateContent`, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: MAX_OUTPUT_TOKENS },
    });
    return this.extrair(data).texto;
  }

  /**
   * Uma rodada de conversa com ferramentas disponíveis.
   *
   * Devolve OU o texto final OU a lista de ferramentas que o modelo quer
   * executar — quem roda o laço é o service, que é onde vive a autorização.
   * O cliente aqui não decide nada sobre permissão.
   */
  async gerarComFerramentas(
    contents: ConteudoGemini[],
    ferramentas: DeclaracaoFerramenta[],
    instrucaoSistema?: string,
  ): Promise<RespostaGemini> {
    const body: Record<string, unknown> = {
      contents,
      generationConfig: { temperature: 0.3, maxOutputTokens: MAX_OUTPUT_TOKENS },
    };
    if (instrucaoSistema) {
      body['systemInstruction'] = { parts: [{ text: instrucaoSistema }] };
    }
    if (ferramentas.length > 0) {
      body['tools'] = [{ functionDeclarations: ferramentas }];
      body['toolConfig'] = { functionCallingConfig: { mode: 'AUTO' } };
    }
    return this.extrair(await this.call(`models/${GEN_MODEL}:generateContent`, body));
  }

  /**
   * Separa texto e chamadas de ferramenta, PRESERVANDO as parts originais.
   *
   * `chamadas` serve só para o service saber o que executar; o que volta para
   * a API na rodada seguinte é `partesModelo`, sem reconstrução — ver o
   * comentário em RespostaGemini sobre o thought_signature.
   */
  private extrair(data: any): RespostaGemini {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return { texto: '', chamadas: [], partesModelo: [] };

    const texto = parts
      .map((p: any) => p?.text ?? '')
      .join('')
      .trim();
    const chamadas = parts
      .filter((p: any) => p?.functionCall?.name)
      .map((p: any) => ({
        name: String(p.functionCall.name),
        args: p.functionCall.args ?? {},
      }));
    return { texto, chamadas, partesModelo: parts };
  }
}

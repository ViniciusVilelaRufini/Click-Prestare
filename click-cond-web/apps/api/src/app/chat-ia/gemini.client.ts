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
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    });
    const parts = data?.candidates?.[0]?.content?.parts;
    const texto = Array.isArray(parts)
      ? parts.map((p: any) => p.text ?? '').join('')
      : '';
    return texto.trim();
  }
}

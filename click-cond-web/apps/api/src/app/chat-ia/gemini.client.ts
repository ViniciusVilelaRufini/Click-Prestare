import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/**
 * Wrapper fino da API REST do Google Gemini para o Assistente IA.
 *
 * Usa o `fetch` nativo do Node — sem SDK. A chave vem de GEMINI_API_KEY e
 * NUNCA vai para o app: o Flutter só fala com este backend.
 *
 *  - text-embedding-004 → embeddings (768 dims) do RAG de atas/documentos
 *  - gemini-2.0-flash   → geração da resposta final
 */
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const EMBED_MODEL = 'text-embedding-004';
const GEN_MODEL = 'gemini-2.0-flash';

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

  /** Embedding de um texto. Retorna array de floats (768). */
  async embedText(texto: string): Promise<number[]> {
    const data = await this.call(`models/${EMBED_MODEL}:embedContent`, {
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: texto }] },
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

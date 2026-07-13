/**
 * Wrapper fino da API do Google Gemini (REST) para o Assistente IA.
 *
 * Usa o `fetch` nativo do Node (>=18; o projeto roda em Node 24), então não
 * precisa de SDK. A chave vem de process.env.GEMINI_API_KEY — NUNCA hardcode
 * e NUNCA exponha no app (o Flutter só fala com este backend).
 *
 * Modelos:
 *  - text-embedding-004  → embeddings (768 dims) para o RAG das atas/documentos
 *  - gemini-2.0-flash    → geração da resposta final
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const EMBED_MODEL = 'text-embedding-004';
const GEN_MODEL = 'gemini-2.0-flash';

function getKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY não configurada. Defina a variável de ambiente com a chave do Google AI Studio.',
    );
  }
  return key;
}

async function callGemini(path, body) {
  const url = `${API_BASE}/${path}?key=${getKey()}`;
  const res = await fetch(url, {
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

/**
 * Gera o embedding de um único texto. Retorna array de floats (768).
 */
async function embedText(texto) {
  const data = await callGemini(`models/${EMBED_MODEL}:embedContent`, {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text: texto }] },
  });
  return data.embedding.values;
}

/**
 * Gera embeddings de vários textos numa só chamada (batchEmbedContents).
 * Retorna array de vetores na mesma ordem dos textos.
 */
async function embedBatch(textos) {
  if (!textos || textos.length === 0) return [];
  const data = await callGemini(`models/${EMBED_MODEL}:batchEmbedContents`, {
    requests: textos.map((t) => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: t }] },
    })),
  });
  return (data.embeddings || []).map((e) => e.values);
}

/**
 * Gera a resposta final a partir de um prompt completo (já com instrução de
 * sistema + contexto + histórico + pergunta embutidos).
 */
async function gerarResposta(prompt) {
  const data = await callGemini(`models/${GEN_MODEL}:generateContent`, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
    },
  });
  const cand = data.candidates && data.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  const texto = parts ? parts.map((p) => p.text || '').join('') : '';
  return texto.trim();
}

module.exports = { embedText, embedBatch, gerarResposta };

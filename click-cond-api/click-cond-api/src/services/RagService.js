const gemini = require('../libs/gemini');
const DB_ChatIa = require('../database/DB_ChatIa');
const DB_Documents = require('../database/DB_Documents');
const DB_Condominio = require('../database/DB_Condominio');
const DB_Funcionarios = require('../database/DB_Funcionarios');
const DB_Visitantes = require('../database/DB_Visitantes');
const DB_Moradores = require('../database/DB_Moradores');
const db = require('../database/MySQL.js');

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
const CHUNK_SIZE = 1200; // caracteres por trecho
const CHUNK_OVERLAP = 200; // sobreposição p/ não cortar contexto no meio
const TOP_K = 5; // trechos recuperados por pergunta
const VISITAS_LIMIT_DIAS = 30; // janela de "entradas/saídas recentes"

// ---------------------------------------------------------------------------
// Utilidades de texto / vetores
// ---------------------------------------------------------------------------
function chunkText(texto) {
  const clean = (texto || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + CHUNK_SIZE, clean.length);
    chunks.push(clean.substring(start, end));
    if (end >= clean.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function baixarTextoPdf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar documento (${res.status}): ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  // require adiado: pdf-parse tenta ler um arquivo de teste se importado no topo.
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return data.text || '';
}

// ---------------------------------------------------------------------------
// Indexação (embeddings de atas/documentos)
// ---------------------------------------------------------------------------

/**
 * (Re)indexa um único documento: baixa o PDF, extrai texto, gera embeddings
 * dos trechos e substitui os embeddings antigos daquele documento.
 */
async function reindexDocumento(idCondominio, doc) {
  const sourceType = doc.is_ata ? 'ata' : 'documento';
  await DB_ChatIa.deleteEmbeddingsBySource(idCondominio, doc.id);

  const link = doc.link_doc || '';
  if (!/\.pdf($|\?)/i.test(link)) {
    // Só processamos PDFs por enquanto (atas/documentos são PDFs no S3).
    return { skipped: true, motivo: 'nao_pdf' };
  }

  let texto = '';
  try {
    texto = await baixarTextoPdf(link);
  } catch (err) {
    console.warn(`[RAG] Não foi possível extrair "${doc.nome}": ${err.message}`);
    return { skipped: true, motivo: 'extracao_falhou' };
  }

  const pedacos = chunkText(texto);
  if (pedacos.length === 0) return { skipped: true, motivo: 'vazio' };

  // Prefixa cada trecho com o nome do documento p/ dar contexto à busca.
  const textosParaEmbed = pedacos.map((p) => `[${doc.nome}] ${p}`);
  const vetores = await gemini.embedBatch(textosParaEmbed);

  const chunks = pedacos.map((p, i) => ({
    chunk_index: i,
    chunk_text: `[${doc.nome}] ${p}`,
    embedding: vetores[i],
  }));
  await DB_ChatIa.insertEmbeddings(idCondominio, sourceType, doc.id, chunks);
  return { indexed: chunks.length };
}

/**
 * Reindexa TODAS as atas e documentos de um condomínio.
 */
async function reindexCondominio(idCondominio) {
  const atas = await DB_Documents.getAll(idCondominio, 1);
  const docs = await DB_Documents.getAll(idCondominio, 0);
  const todos = [
    ...(atas || []).map((d) => ({ ...d, is_ata: 1 })),
    ...(docs || []).map((d) => ({ ...d, is_ata: 0 })),
  ];

  let totalChunks = 0;
  let processados = 0;
  for (const doc of todos) {
    try {
      const r = await reindexDocumento(idCondominio, doc);
      if (r.indexed) {
        totalChunks += r.indexed;
        processados += 1;
      }
    } catch (err) {
      console.error(`[RAG] Erro ao indexar doc ${doc.id}:`, err.message);
    }
  }
  return { documentos: processados, chunks: totalChunks, total_docs: todos.length };
}

// ---------------------------------------------------------------------------
// Recuperação (busca semântica nos embeddings)
// ---------------------------------------------------------------------------
async function buscarTrechos(idCondominio, pergunta, k = TOP_K) {
  const linhas = await DB_ChatIa.getEmbeddingsByCond(idCondominio);
  if (!linhas.length) return [];

  const vetorPergunta = await gemini.embedText(pergunta);
  const rankeado = linhas
    .map((l) => ({ texto: l.chunk_text, score: cosine(vetorPergunta, l.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  // Descarta trechos pouco relevantes (ruído).
  return rankeado.filter((r) => r.score > 0.5).map((r) => r.texto);
}

// ---------------------------------------------------------------------------
// Contexto estruturado (ao vivo do MySQL, com escopo por papel)
// ---------------------------------------------------------------------------

async function getAptosDoMorador(idUser, idCondominio) {
  const query = `select au.id_apto from Apartamentos_Users au
                 inner join Apartamentos a on a.id = au.id_apto
                 where au.id_user = ? and a.id_condominio = ?`;
  const { results } = await db.queryParam(query, [idUser, idCondominio]);
  return results.map((r) => r.id_apto);
}

function formatVisita(v) {
  const partes = [`${v.nome} (apto ${v.apto_bloco ? v.apto_bloco + '-' : ''}${v.apto})`];
  if (v.is_prestador) partes.push('prestador');
  partes.push(v.data_hora ? `agendado ${v.data_hora}` : '');
  partes.push(v.hora_entrada ? `entrada ${v.hora_entrada}` : 'sem entrada registrada');
  if (v.hora_saida) partes.push(`saída ${v.hora_saida}`);
  return '- ' + partes.filter(Boolean).join(', ');
}

/**
 * Monta um bloco de texto com os dados estruturados do condomínio,
 * respeitando o papel do usuário (síndico vê tudo; morador só o próprio apto).
 */
async function montarContextoEstruturado(idCondominio, user) {
  const isSindico = user.typeAccess === 'Sindico' || user.typeAccess === 'Funcionario';
  const blocos = [];

  // 1. Informações gerais (todos)
  try {
    const infos = await DB_Condominio.getInfos(idCondominio);
    const end = await DB_Condominio.getAddress(idCondominio);
    if (infos) {
      const linhas = [
        `Nome: ${infos.nome}`,
        infos.identificacao ? `CNPJ/Identificação: ${infos.identificacao}` : '',
        infos.subsindico_nome ? `Subsíndico: ${infos.subsindico_nome}` : '',
        infos.data_inicio_mandato
          ? `Mandato: ${infos.data_inicio_mandato} a ${infos.data_termino_mandato}`
          : '',
        end ? `Endereço: ${end.rua}, ${end.numero} - ${end.bairro}, ${end.cidade}/${end.uf}` : '',
      ].filter(Boolean);
      blocos.push('### Informações gerais do condomínio\n' + linhas.join('\n'));
    }
  } catch (e) {
    console.warn('[RAG] contexto info geral falhou:', e.message);
  }

  // 2. Funcionários (todos; nome + função apenas)
  try {
    const funcs = await DB_Funcionarios.getAll(idCondominio, 0);
    if (funcs && funcs.length) {
      const linhas = funcs.map((f) => `- ${f.nome}${f.funcao ? ` — ${f.funcao}` : ''}`);
      blocos.push('### Funcionários\n' + linhas.join('\n'));
    }
  } catch (e) {
    console.warn('[RAG] contexto funcionários falhou:', e.message);
  }

  // 3. Visitas / entradas e saídas (escopo por papel)
  try {
    let visitas;
    if (isSindico) {
      visitas = await DB_Visitantes.getAll(idCondominio, 0, null, null, null, null);
    } else {
      // Morador: filtra pelos aptos/usuário dele.
      const aptos = await getAptosDoMorador(user.id, idCondominio);
      visitas = await DB_Visitantes.getAll(idCondominio, 0, null, null, user.id, aptos);
    }
    if (visitas && visitas.length) {
      const linhas = visitas.slice(0, 30).map(formatVisita);
      const titulo = isSindico
        ? '### Visitas recentes (todo o condomínio)'
        : '### Suas visitas recentes';
      blocos.push(titulo + '\n' + linhas.join('\n'));
    }
  } catch (e) {
    console.warn('[RAG] contexto visitas falhou:', e.message);
  }

  // 4. Moradores (síndico: todos; morador: só o próprio registro)
  try {
    if (isSindico) {
      const moradores = await DB_Moradores.getAll(idCondominio, 0);
      if (moradores && moradores.length) {
        const linhas = moradores.map(
          (m) => `- ${m.nome}${m.apartamento ? ` (apto ${m.bloco ? m.bloco + '-' : ''}${m.apartamento})` : ''}${m.tipo ? ` — ${m.tipo}` : ''}`,
        );
        blocos.push('### Moradores\n' + linhas.join('\n'));
      }
    } else {
      const meu = await DB_Moradores.get(user.id, idCondominio);
      if (meu) {
        blocos.push(
          '### Seu cadastro\n' +
            `- ${meu.nome}${meu.telefone ? `, tel ${meu.telefone}` : ''}${meu.email ? `, ${meu.email}` : ''}`,
        );
      }
    }
  } catch (e) {
    console.warn('[RAG] contexto moradores falhou:', e.message);
  }

  return blocos.join('\n\n');
}

// ---------------------------------------------------------------------------
// Montagem do prompt + resposta
// ---------------------------------------------------------------------------
function montarPrompt({ contextoEstruturado, trechosDocs, historico, pergunta, papel }) {
  const papelDesc =
    papel === 'Sindico'
      ? 'síndico (tem acesso a todos os dados do condomínio)'
      : papel === 'Funcionario'
        ? 'funcionário/portaria'
        : 'morador (só pode ver os próprios dados)';

  const historicoTxt = (historico || [])
    .map((h) => `${h.papel === 'assistant' ? 'Assistente' : 'Usuário'}: ${h.mensagem}`)
    .join('\n');

  const docsTxt = trechosDocs && trechosDocs.length
    ? trechosDocs.map((t, i) => `[Documento ${i + 1}]\n${t}`).join('\n\n')
    : '(nenhum trecho de ata/documento relevante encontrado)';

  return `Você é o assistente virtual do condomínio no app Click. Responda em português do Brasil, de forma clara, cordial e objetiva.

REGRAS:
- Use SOMENTE as informações fornecidas no CONTEXTO abaixo. Não invente dados.
- Se a informação não estiver no contexto, diga que não encontrou esse dado e sugira quem procurar (síndico/portaria).
- O usuário atual é ${papelDesc}. Nunca revele dados fora do que está no contexto.
- Seja breve. Use listas quando ajudar na leitura.

=== CONTEXTO: DADOS ATUAIS DO CONDOMÍNIO ===
${contextoEstruturado || '(sem dados estruturados disponíveis)'}

=== CONTEXTO: TRECHOS DE ATAS E DOCUMENTOS ===
${docsTxt}

${historicoTxt ? `=== HISTÓRICO DA CONVERSA ===\n${historicoTxt}\n` : ''}
=== PERGUNTA DO USUÁRIO ===
${pergunta}

Resposta:`;
}

/**
 * Fluxo completo: recupera contexto (híbrido), monta prompt, chama Gemini e
 * persiste o turno no histórico.
 */
async function responder(idCondominio, user, pergunta) {
  const [contextoEstruturado, trechosDocs, historico] = await Promise.all([
    montarContextoEstruturado(idCondominio, user),
    buscarTrechos(idCondominio, pergunta),
    DB_ChatIa.getHistoricoRecente(idCondominio, user.id, 12),
  ]);

  const prompt = montarPrompt({
    contextoEstruturado,
    trechosDocs,
    historico,
    pergunta,
    papel: user.typeAccess,
  });

  const resposta = await gemini.gerarResposta(prompt);

  // Persiste o turno (não bloqueia a resposta em caso de erro de escrita).
  DB_ChatIa.salvarTurno(idCondominio, user.id, 'user', pergunta).catch(() => {});
  DB_ChatIa.salvarTurno(idCondominio, user.id, 'assistant', resposta).catch(() => {});

  return resposta;
}

module.exports = {
  reindexCondominio,
  reindexDocumento,
  buscarTrechos,
  montarContextoEstruturado,
  responder,
};

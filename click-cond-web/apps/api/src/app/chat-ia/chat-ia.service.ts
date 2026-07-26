import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { assertSindico } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { GeminiClient } from './gemini.client';
import type {
  ChamadaFerramenta,
  ConteudoGemini,
} from './gemini.client';
import {
  declaracoesPara,
  resolverFerramenta,
  type ContextoFerramenta,
  type PapelChat,
} from './chat-ia.tools';

const CHUNK_SIZE = 1200; // caracteres por trecho
const CHUNK_OVERLAP = 200; // sobreposição p/ não cortar contexto no meio
const TOP_K = 5; // trechos recuperados por pergunta
const SCORE_MINIMO = 0.5; // abaixo disso o trecho é ruído
const HISTORICO_TURNOS = 12;

/**
 * Teto de idas e voltas com ferramentas numa única pergunta. Cada rodada é
 * uma chamada paga ao Gemini; sem teto, um modelo confuso pediria ferramenta
 * indefinidamente.
 */
const MAX_RODADAS_FERRAMENTA = 5;

/**
 * Assistente IA do condomínio (RAG híbrido).
 *
 * Combina dois contextos antes de chamar o Gemini:
 *  1. Dados estruturados ao vivo do MySQL (condomínio, funcionários, visitas,
 *     moradores) — SEMPRE recortados pelo papel de quem perguntou.
 *  2. Trechos de atas/documentos recuperados por similaridade de embeddings.
 *
 * O recorte por papel é a parte crítica: o modelo responde com o que estiver
 * no prompt, então um morador nunca pode receber no contexto os dados de
 * outro apartamento. Instrução no prompt não é controle de acesso — o filtro
 * acontece aqui, na montagem.
 */
@Injectable()
export class ChatIaService {
  private readonly logger = new Logger(ChatIaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantAccessService,
    private readonly gemini: GeminiClient,
  ) {}

  // =========================================================================
  // Fluxo principal
  // =========================================================================

  async responder(idCondominio: number, pergunta: string, user: JwtPayload) {
    if (!idCondominio || Number.isNaN(idCondominio)) {
      throw new BadRequestException('id_condominio é obrigatório.');
    }
    const texto = (pergunta ?? '').toString().trim();
    if (!texto) {
      throw new BadRequestException('A pergunta não pode ser vazia.');
    }
    await this.tenant.assertCondominio(idCondominio, user);

    const idUser = Number(user?.user?.id ?? user?.sub);
    const papel = this.papelDe(user);

    const [ctxFerramenta, contextoEstruturado, trechosDocs, historico] = await Promise.all([
      this.montarContextoFerramenta(idCondominio, idUser, papel),
      this.montarContextoEstruturado(idCondominio, user),
      this.buscarTrechos(idCondominio, texto),
      this.getHistoricoRecente(idCondominio, idUser),
    ]);

    const instrucao = this.montarInstrucaoSistema({
      contextoEstruturado,
      trechosDocs,
      papel,
    });

    // Histórico + pergunta atual no formato de conversa do Gemini.
    const contents: ConteudoGemini[] = [
      ...this.normalizarHistorico(historico),
      { role: 'user' as const, parts: [{ text: texto }] },
    ];

    let resposta: string;
    try {
      resposta = await this.rodarLacoDeFerramentas(contents, instrucao, ctxFerramenta);
    } catch (e: any) {
      // O erro do provedor NUNCA vai para a tela: o app exibe o `message` da
      // resposta, e um 404 de modelo aposentado apareceu como se fosse a fala
      // do assistente. Detalhe fica no log, usuário recebe algo acionável.
      this.logger.error(`falha ao gerar resposta: ${e?.message ?? e}`);
      throw new ServiceUnavailableException(
        'Não consegui responder agora. Tente novamente em instantes.',
      );
    }

    // Grava os dois turnos em ORDEM. Antes eram dois inserts disparados com
    // `void` em paralelo: eles corriam entre si e o id saía trocado, deixando
    // a resposta gravada antes da pergunta e embaralhando a memória da conversa.
    void this.salvarTurnos(idCondominio, idUser, [
      { papel: 'user', mensagem: texto },
      { papel: 'assistant', mensagem: resposta },
    ]);

    return { resposta };
  }

  /**
   * Converte o histórico em turnos de conversa VÁLIDOS para o generateContent.
   *
   * A API exige que os turnos alternem user/model e comecem em user. O
   * histórico gravado no banco não garante isso:
   *  - linhas antigas ficaram fora de ordem (dois `assistant` seguidos), do bug
   *    de gravação concorrente que já foi corrigido — mas os registros ruins
   *    continuam lá;
   *  - uma pergunta cuja resposta nunca foi gravada deixa um `user` órfão no
   *    fim, que somado à pergunta atual vira user -> user.
   *
   * Qualquer uma das duas faz o Gemini responder 400 e derruba a conversa
   * inteira. Enquanto o histórico era concatenado num único bloco de texto
   * isso não aparecia; ao virar turnos de verdade, virou falha fatal.
   *
   * Normalizar na LEITURA é o que protege dos dados legados — corrigir só a
   * escrita não desfaz o que já está gravado.
   */
  private normalizarHistorico(
    historico: { papel: string; mensagem: string }[],
  ): ConteudoGemini[] {
    const turnos: ConteudoGemini[] = [];

    for (const h of historico) {
      const role: 'user' | 'model' = h.papel === 'assistant' ? 'model' : 'user';
      const texto = (h.mensagem ?? '').trim();
      if (!texto) continue;

      // Não pode começar por model.
      if (turnos.length === 0 && role === 'model') continue;

      const ultimo = turnos[turnos.length - 1];
      if (ultimo?.role === role) {
        // Dois turnos seguidos do mesmo lado: fica o mais recente.
        turnos[turnos.length - 1] = { role, parts: [{ text: texto }] };
        continue;
      }
      turnos.push({ role, parts: [{ text: texto }] });
    }

    // A pergunta atual entra como `user`; se o histórico já termina em `user`
    // (pergunta que ficou sem resposta), remove para não mandar user -> user.
    if (turnos[turnos.length - 1]?.role === 'user') turnos.pop();

    return turnos;
  }

  /**
   * Laço de function calling.
   *
   * O modelo pede ferramentas, executamos, devolvemos o resultado e ele
   * continua — até produzir texto ou estourar o limite de rodadas (proteção
   * contra laço infinito, que sairia caro em chamadas pagas).
   */
  private async rodarLacoDeFerramentas(
    contents: ConteudoGemini[],
    instrucao: string,
    ctx: ContextoFerramenta,
  ): Promise<string> {
    const declaracoes = declaracoesPara(ctx.papel);

    for (let rodada = 0; rodada < MAX_RODADAS_FERRAMENTA; rodada++) {
      const r = await this.gemini.gerarComFerramentas(contents, declaracoes, instrucao);

      if (r.chamadas.length === 0) {
        return r.texto || 'Não consegui formular uma resposta para isso.';
      }

      // Devolve o turno do modelo VERBATIM. Remontar as parts a partir de
      // { name, args } descarta o thought_signature que o Gemini 3.x embute no
      // functionCall, e a rodada seguinte morre com 400
      // "Function call is missing a thought_signature in functionCall parts".
      contents.push({ role: 'model', parts: r.partesModelo });

      // ...executa e devolve os resultados.
      const partes = [];
      for (const chamada of r.chamadas) {
        const resultado = await this.executarFerramenta(chamada, ctx);
        partes.push({
          functionResponse: { name: chamada.name, response: { result: resultado } },
        });
      }
      contents.push({ role: 'user', parts: partes });
    }

    this.logger.warn(`limite de ${MAX_RODADAS_FERRAMENTA} rodadas de ferramenta atingido`);
    return 'Não consegui concluir essa consulta. Tente reformular a pergunta.';
  }

  /**
   * Executa UMA ferramenta.
   *
   * `resolverFerramenta` filtra pelo papel: se o modelo pedir algo que aquele
   * papel não pode usar, não executa — devolve erro para ele se corrigir. É a
   * segunda camada de autorização (a primeira é o catálogo declarado).
   */
  private async executarFerramenta(chamada: ChamadaFerramenta, ctx: ContextoFerramenta) {
    const ferramenta = resolverFerramenta(chamada.name, ctx.papel);
    if (!ferramenta) {
      this.logger.warn(
        `ferramenta "${chamada.name}" negada para papel ${ctx.papel} (user#${ctx.idUser})`,
      );
      return { erro: 'Ferramenta indisponível para o seu perfil de acesso.' };
    }
    try {
      const inicio = Date.now();
      const saida = await ferramenta.executar(chamada.args ?? {}, ctx);
      this.logger.log(
        `ferramenta ${chamada.name} (${ctx.papel}, cond#${ctx.idCondominio}) em ${Date.now() - inicio}ms`,
      );
      return saida;
    } catch (e: any) {
      this.logger.error(`ferramenta ${chamada.name} falhou: ${e?.message ?? e}`);
      return { erro: 'Não foi possível consultar esse dado agora.' };
    }
  }

  /** Contexto que as ferramentas usam para escopar tudo. Sai do JWT. */
  private async montarContextoFerramenta(
    idCondominio: number,
    idUser: number,
    papel: PapelChat,
  ): Promise<ContextoFerramenta> {
    const vinculos = await this.prisma.apartamentos_Users.findMany({
      where: { id_user: idUser, apartamento: { id_condominio: idCondominio } },
      select: { id_apto: true },
    });
    return {
      idCondominio,
      idUser,
      papel,
      staff: papel === 'Sindico' || papel === 'Funcionario',
      aptos: vinculos.map((v) => v.id_apto),
      prisma: this.prisma,
    };
  }

  // =========================================================================
  // Contexto estruturado (MySQL ao vivo, recortado por papel)
  // =========================================================================

  /**
   * Papel de quem perguntou. É o que define o catálogo de ferramentas, então
   * qualquer valor inesperado cai no menos privilegiado (Morador).
   */
  private papelDe(user?: JwtPayload): PapelChat {
    const bruto = String(user?.typeAccess ?? user?.user?.typeAccess ?? '');
    if (bruto === 'Sindico' || bruto === 'Funcionario') return bruto;
    return 'Morador';
  }

  private async montarContextoEstruturado(idCondominio: number, user: JwtPayload) {
    const idUser = Number(user?.user?.id ?? user?.sub);
    const blocos: string[] = [];

    // 1. Informações gerais — todos os papéis.
    try {
      const cond = await this.prisma.condominios.findUnique({
        where: { id: idCondominio },
        include: { enderecoRel: true },
      });
      if (cond) {
        const end = cond.enderecoRel;
        const linhas = [
          `Nome: ${cond.nome}`,
          cond.identificacao ? `CNPJ/Identificação: ${cond.identificacao}` : '',
          cond.subsindico_nome ? `Subsíndico: ${cond.subsindico_nome}` : '',
          cond.data_inicio_mandato
            ? `Mandato: ${this.fmtData(cond.data_inicio_mandato)} a ${this.fmtData(cond.data_termino_mandato)}`
            : '',
          end
            ? `Endereço: ${end.rua ?? ''}, ${end.numero ?? ''} - ${end.bairro ?? ''}, ${end.cidade ?? ''}/${end.uf ?? ''}`
            : '',
        ].filter(Boolean);
        blocos.push('### Informações gerais do condomínio\n' + linhas.join('\n'));
      }
    } catch (e: any) {
      this.logger.warn(`contexto info geral falhou: ${e?.message ?? e}`);
    }

    // 2. Funcionários — todos os papéis, só nome + função.
    try {
      const funcs = await this.prisma.funcionarios.findMany({
        where: { id_condominio: idCondominio },
        select: { nome: true, funcao: true },
        orderBy: { nome: 'asc' },
      });
      if (funcs.length) {
        blocos.push(
          '### Funcionários\n' +
            funcs.map((f) => `- ${f.nome}${f.funcao ? ` — ${f.funcao}` : ''}`).join('\n'),
        );
      }
    } catch (e: any) {
      this.logger.warn(`contexto funcionários falhou: ${e?.message ?? e}`);
    }

    // 3. Cadastro do próprio usuário — ajuda o modelo a saber "quem é você"
    //    sem precisar gastar uma rodada de ferramenta.
    try {
      const meu = await this.prisma.moradores.findFirst({
        where: { id_user: idUser, id_condominio: idCondominio },
        select: { nome: true, telefone: true, email: true, bloco: true, apartamento: true, tipo: true },
      });
      if (meu) {
        blocos.push(
          '### Cadastro do usuário que está perguntando\n' +
            `- ${meu.nome}` +
            (meu.apartamento ? ` (apto ${meu.bloco ? meu.bloco + '-' : ''}${meu.apartamento})` : '') +
            (meu.tipo ? ` — ${meu.tipo}` : '') +
            (meu.telefone ? `, tel ${meu.telefone}` : ''),
        );
      }
    } catch (e: any) {
      this.logger.warn(`contexto cadastro falhou: ${e?.message ?? e}`);
    }

    // As listas grandes (moradores, visitas) NÃO entram mais aqui: viraram
    // ferramentas. No condomínio #7, só o bloco de moradores dava ~3.000
    // tokens enviados em toda pergunta, inclusive nas que não tinham nada a
    // ver com moradores. Agora o modelo busca quando precisa.

    return blocos.join('\n\n');
  }

  // =========================================================================
  // Busca semântica nos embeddings
  // =========================================================================

  private async buscarTrechos(idCondominio: number, pergunta: string): Promise<string[]> {
    if (!this.gemini.isConfigured) return [];
    try {
      const linhas = await this.prisma.rag_Embeddings.findMany({
        where: { id_condominio: idCondominio },
        select: { chunk_text: true, embedding: true },
      });
      if (!linhas.length) return [];

      const vetorPergunta = await this.gemini.embedText(pergunta);
      return linhas
        .map((l) => ({
          texto: l.chunk_text,
          score: this.cosine(vetorPergunta, this.toVetor(l.embedding)),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_K)
        .filter((r) => r.score > SCORE_MINIMO)
        .map((r) => r.texto);
    } catch (e: any) {
      // Documentos indisponíveis não devem derrubar a conversa — o contexto
      // estruturado sozinho já responde boa parte das perguntas.
      this.logger.warn(`busca semântica falhou: ${e?.message ?? e}`);
      return [];
    }
  }

  private toVetor(raw: unknown): number[] {
    if (Array.isArray(raw)) return raw as number[];
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    }
    return [];
  }

  private cosine(a: number[], b: number[]): number {
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

  // =========================================================================
  // Histórico
  // =========================================================================

  private async getHistoricoRecente(idCondominio: number, idUser: number) {
    if (!idUser || Number.isNaN(idUser)) return [];
    try {
      const linhas = await this.prisma.chat_Ia_Historico.findMany({
        where: { id_condominio: idCondominio, id_user: idUser },
        select: { papel: true, mensagem: true },
        orderBy: { id: 'desc' },
        take: HISTORICO_TURNOS,
      });
      return linhas.reverse();
    } catch (e: any) {
      this.logger.warn(`histórico indisponível: ${e?.message ?? e}`);
      return [];
    }
  }

  /**
   * Grava os turnos preservando a ORDEM.
   *
   * O createMany insere na ordem do array, então os ids saem crescentes e o
   * getHistoricoRecente (que ordena por id) reconstrói a conversa certa.
   * A versão anterior disparava dois inserts concorrentes e a resposta
   * chegava a ficar gravada ANTES da pergunta.
   */
  private async salvarTurnos(
    idCondominio: number,
    idUser: number,
    turnos: { papel: 'user' | 'assistant'; mensagem: string }[],
  ) {
    if (!idUser || Number.isNaN(idUser)) return;
    const validos = turnos.filter((t) => t.mensagem);
    if (validos.length === 0) return;
    try {
      await this.prisma.chat_Ia_Historico.createMany({
        data: validos.map((t) => ({
          id_condominio: idCondominio,
          id_user: idUser,
          papel: t.papel,
          mensagem: t.mensagem,
        })),
      });
    } catch (e: any) {
      this.logger.warn(`não gravou turnos do histórico: ${e?.message ?? e}`);
    }
  }

  // =========================================================================
  // Instrução de sistema
  // =========================================================================

  /**
   * O histórico e a pergunta NÃO entram mais aqui: viram turnos de conversa
   * em `contents`. Isso deixa o modelo distinguir o que é instrução do que é
   * fala do usuário — antes tudo era um bloco de texto só.
   */
  private montarInstrucaoSistema(args: {
    contextoEstruturado: string;
    trechosDocs: string[];
    papel: PapelChat;
  }): string {
    const papelDesc =
      args.papel === 'Sindico'
        ? 'síndico (administra o condomínio)'
        : args.papel === 'Funcionario'
          ? 'funcionário/portaria'
          : 'morador (só enxerga os próprios dados e os do seu apartamento)';

    const docsTxt = args.trechosDocs?.length
      ? args.trechosDocs.map((t, i) => `[Documento ${i + 1}]\n${t}`).join('\n\n')
      : '(nenhum trecho de ata/documento relevante para esta pergunta)';

    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    return `Você é o assistente virtual do condomínio no app Click. Responda em português do Brasil, de forma clara, cordial e objetiva.

Hoje é ${hoje}. O usuário atual é ${papelDesc}.

COMO TRABALHAR:
- Você tem FERRAMENTAS para consultar os dados do condomínio. Sempre que a pergunta pedir algo que não está no contexto abaixo, CHAME a ferramenta apropriada em vez de dizer que não sabe.
- Para perguntas de quantidade ("quantos moradores", "quantas unidades"), use as ferramentas de contagem. Não tente contar itens de uma lista.
- Você só enxerga as ferramentas permitidas para este perfil. Se uma consulta não for possível, explique de forma simples e sugira procurar o síndico ou a portaria — nunca afirme que o dado não existe.
- Não invente dados. Só afirme o que veio do contexto ou do resultado das ferramentas.
- Seja breve. Se um resultado tiver muitos itens, resuma (total + os mais relevantes) em vez de listar tudo.

=== CONTEXTO FIXO: DADOS DO CONDOMÍNIO ===
${args.contextoEstruturado || '(sem dados estruturados disponíveis)'}

=== CONTEXTO: TRECHOS DE ATAS E DOCUMENTOS ===
${docsTxt}`;
  }

  // =========================================================================
  // Indexação de atas/documentos
  // =========================================================================

  /** Reindexa todas as atas e documentos do condomínio. Só síndico. */
  async reindexCondominio(idCondominio: number, user: JwtPayload) {
    assertSindico(user, 'reindexar documentos do assistente');
    await this.tenant.assertCondominio(idCondominio, user);

    const docs = await this.prisma.documentos.findMany({
      where: { id_condominio: idCondominio },
      select: { id: true, nome: true, link_doc: true, is_ata: true },
    });

    let totalChunks = 0;
    let processados = 0;
    for (const doc of docs) {
      try {
        const r = await this.reindexDocumento(idCondominio, doc);
        if (r.indexed) {
          totalChunks += r.indexed;
          processados += 1;
        }
      } catch (e: any) {
        this.logger.error(`erro ao indexar doc ${doc.id}: ${e?.message ?? e}`);
      }
    }
    return { ok: true, documentos: processados, chunks: totalChunks, total_docs: docs.length };
  }

  private async reindexDocumento(
    idCondominio: number,
    doc: { id: number; nome: string; link_doc: string | null; is_ata: number },
  ): Promise<{ indexed?: number; skipped?: boolean; motivo?: string }> {
    await this.prisma.rag_Embeddings.deleteMany({
      where: { id_condominio: idCondominio, source_id: doc.id },
    });

    const link = doc.link_doc ?? '';
    if (!/\.pdf($|\?)/i.test(link)) {
      return { skipped: true, motivo: 'nao_pdf' };
    }

    let texto = '';
    try {
      texto = await this.extrairTextoPdf(link);
    } catch (e: any) {
      this.logger.warn(`não extraiu "${doc.nome}": ${e?.message ?? e}`);
      return { skipped: true, motivo: 'extracao_falhou' };
    }

    const pedacos = this.chunkText(texto);
    if (!pedacos.length) return { skipped: true, motivo: 'vazio' };

    // Prefixa com o nome do documento p/ dar contexto à busca.
    const textos = pedacos.map((p) => `[${doc.nome}] ${p}`);
    const vetores = await this.gemini.embedBatch(textos);

    await this.prisma.rag_Embeddings.createMany({
      data: textos.map((t, i) => ({
        id_condominio: idCondominio,
        source_type: doc.is_ata ? 'ata' : 'documento',
        source_id: doc.id,
        chunk_index: i,
        chunk_text: t,
        embedding: vetores[i] ?? [],
      })),
    });
    return { indexed: textos.length };
  }

  private async extrairTextoPdf(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Falha ao baixar documento (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    // require adiado de propósito: importado no topo, o pdf-parse tenta ler um
    // PDF de teste do próprio pacote e quebra o boot.
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data?.text ?? '';
  }

  private chunkText(texto: string): string[] {
    const clean = (texto ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const chunks: string[] = [];
    let start = 0;
    while (start < clean.length) {
      const end = Math.min(start + CHUNK_SIZE, clean.length);
      chunks.push(clean.substring(start, end));
      if (end >= clean.length) break;
      start = end - CHUNK_OVERLAP;
    }
    return chunks;
  }

  // =========================================================================

  private fmtData(d: Date | null | undefined): string {
    return d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
  }

}

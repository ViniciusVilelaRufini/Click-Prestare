import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { assertSindico } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { GeminiClient } from './gemini.client';

const CHUNK_SIZE = 1200; // caracteres por trecho
const CHUNK_OVERLAP = 200; // sobreposição p/ não cortar contexto no meio
const TOP_K = 5; // trechos recuperados por pergunta
const SCORE_MINIMO = 0.5; // abaixo disso o trecho é ruído
const HISTORICO_TURNOS = 12;
const MAX_VISITAS_CONTEXTO = 30;

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
    const [contextoEstruturado, trechosDocs, historico] = await Promise.all([
      this.montarContextoEstruturado(idCondominio, user),
      this.buscarTrechos(idCondominio, texto),
      this.getHistoricoRecente(idCondominio, idUser),
    ]);

    const prompt = this.montarPrompt({
      contextoEstruturado,
      trechosDocs,
      historico,
      pergunta: texto,
      papel: this.papelDe(user),
    });

    const resposta = await this.gemini.gerarResposta(prompt);

    // Persiste o turno sem bloquear a resposta se a escrita falhar.
    void this.salvarTurno(idCondominio, idUser, 'user', texto);
    void this.salvarTurno(idCondominio, idUser, 'assistant', resposta);

    return { resposta };
  }

  // =========================================================================
  // Contexto estruturado (MySQL ao vivo, recortado por papel)
  // =========================================================================

  private papelDe(user?: JwtPayload): string {
    return String(user?.typeAccess ?? user?.user?.typeAccess ?? 'Morador');
  }

  private isStaff(user?: JwtPayload): boolean {
    const papel = this.papelDe(user);
    return papel === 'Sindico' || papel === 'Funcionario';
  }

  private async montarContextoEstruturado(idCondominio: number, user: JwtPayload) {
    const staff = this.isStaff(user);
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

    // 3. Visitas — síndico/funcionário vê o condomínio todo; morador só os
    //    apartamentos a que está vinculado.
    try {
      const where: any = { id_condominio: idCondominio };
      if (!staff) {
        const aptos = await this.getAptosDoMorador(idUser, idCondominio);
        // Sem apartamento vinculado o morador não vê visita nenhuma — melhor
        // um contexto vazio do que vazar o do condomínio inteiro.
        where.id_apartamento = { in: aptos.length ? aptos : [-1] };
      }
      const visitas = await this.prisma.visitantes.findMany({
        where,
        include: { apartamento: { select: { apto: true, bloco: true } } },
        orderBy: { created_at: 'desc' },
        take: MAX_VISITAS_CONTEXTO,
      });
      if (visitas.length) {
        const titulo = staff
          ? '### Visitas recentes (todo o condomínio)'
          : '### Suas visitas recentes';
        blocos.push(titulo + '\n' + visitas.map((v) => this.formatVisita(v)).join('\n'));
      }
    } catch (e: any) {
      this.logger.warn(`contexto visitas falhou: ${e?.message ?? e}`);
    }

    // 4. Moradores — síndico/funcionário vê todos; morador só o próprio cadastro.
    try {
      if (staff) {
        const moradores = await this.prisma.moradores.findMany({
          where: { id_condominio: idCondominio },
          select: { nome: true, bloco: true, apartamento: true, tipo: true },
          orderBy: { nome: 'asc' },
        });
        if (moradores.length) {
          const linhas = moradores.map(
            (m) =>
              `- ${m.nome}` +
              (m.apartamento ? ` (apto ${m.bloco ? m.bloco + '-' : ''}${m.apartamento})` : '') +
              (m.tipo ? ` — ${m.tipo}` : ''),
          );
          blocos.push('### Moradores\n' + linhas.join('\n'));
        }
      } else {
        const meu = await this.prisma.moradores.findFirst({
          where: { id_user: idUser, id_condominio: idCondominio },
          select: { nome: true, telefone: true, email: true, bloco: true, apartamento: true },
        });
        if (meu) {
          blocos.push(
            '### Seu cadastro\n' +
              `- ${meu.nome}` +
              (meu.apartamento ? ` (apto ${meu.bloco ? meu.bloco + '-' : ''}${meu.apartamento})` : '') +
              (meu.telefone ? `, tel ${meu.telefone}` : '') +
              (meu.email ? `, ${meu.email}` : ''),
          );
        }
      }
    } catch (e: any) {
      this.logger.warn(`contexto moradores falhou: ${e?.message ?? e}`);
    }

    return blocos.join('\n\n');
  }

  private async getAptosDoMorador(idUser: number, idCondominio: number): Promise<number[]> {
    if (!idUser || Number.isNaN(idUser)) return [];
    const vinculos = await this.prisma.apartamentos_Users.findMany({
      where: { id_user: idUser, apartamento: { id_condominio: idCondominio } },
      select: { id_apto: true },
    });
    return vinculos.map((v) => v.id_apto);
  }

  private formatVisita(v: any): string {
    const bloco = v.apartamento?.bloco ? `${v.apartamento.bloco}-` : '';
    const partes = [`${v.nome} (apto ${bloco}${v.apartamento?.apto ?? '?'})`];
    if (v.is_prestador) partes.push('prestador');
    if (v.data_hora_inicio) partes.push(`agendado ${this.fmtDataHora(v.data_hora_inicio)}`);
    partes.push(
      v.data_entrada ? `entrada ${this.fmtDataHora(v.data_entrada)}` : 'sem entrada registrada',
    );
    if (v.data_saida) partes.push(`saída ${this.fmtDataHora(v.data_saida)}`);
    return '- ' + partes.filter(Boolean).join(', ');
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

  private async salvarTurno(
    idCondominio: number,
    idUser: number,
    papel: 'user' | 'assistant',
    mensagem: string,
  ) {
    if (!idUser || Number.isNaN(idUser) || !mensagem) return;
    try {
      await this.prisma.chat_Ia_Historico.create({
        data: { id_condominio: idCondominio, id_user: idUser, papel, mensagem },
      });
    } catch (e: any) {
      this.logger.warn(`não gravou turno do histórico: ${e?.message ?? e}`);
    }
  }

  // =========================================================================
  // Prompt
  // =========================================================================

  private montarPrompt(args: {
    contextoEstruturado: string;
    trechosDocs: string[];
    historico: { papel: string; mensagem: string }[];
    pergunta: string;
    papel: string;
  }): string {
    const papelDesc =
      args.papel === 'Sindico'
        ? 'síndico (tem acesso a todos os dados do condomínio)'
        : args.papel === 'Funcionario'
          ? 'funcionário/portaria'
          : 'morador (só pode ver os próprios dados)';

    const historicoTxt = (args.historico ?? [])
      .map((h) => `${h.papel === 'assistant' ? 'Assistente' : 'Usuário'}: ${h.mensagem}`)
      .join('\n');

    const docsTxt = args.trechosDocs?.length
      ? args.trechosDocs.map((t, i) => `[Documento ${i + 1}]\n${t}`).join('\n\n')
      : '(nenhum trecho de ata/documento relevante encontrado)';

    return `Você é o assistente virtual do condomínio no app Click. Responda em português do Brasil, de forma clara, cordial e objetiva.

REGRAS:
- Use SOMENTE as informações fornecidas no CONTEXTO abaixo. Não invente dados.
- Se a informação não estiver no contexto, diga que não encontrou esse dado e sugira quem procurar (síndico/portaria).
- O usuário atual é ${papelDesc}. Nunca revele dados fora do que está no contexto.
- Seja breve. Use listas quando ajudar na leitura.

=== CONTEXTO: DADOS ATUAIS DO CONDOMÍNIO ===
${args.contextoEstruturado || '(sem dados estruturados disponíveis)'}

=== CONTEXTO: TRECHOS DE ATAS E DOCUMENTOS ===
${docsTxt}

${historicoTxt ? `=== HISTÓRICO DA CONVERSA ===\n${historicoTxt}\n` : ''}=== PERGUNTA DO USUÁRIO ===
${args.pergunta}

Resposta:`;
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

  private fmtDataHora(d: Date | null | undefined): string {
    return d
      ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : '';
  }
}

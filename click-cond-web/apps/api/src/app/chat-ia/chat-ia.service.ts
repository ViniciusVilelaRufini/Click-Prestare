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
import { acoesPara, resolverAcao } from './chat-ia.acoes';
import { AcaoPendenteStore, type AcaoPendente } from './acao-pendente.store';
import { AreasSociaisService } from '../areas-sociais/areas-sociais.service';
import { OcorrenciasService } from '../ocorrencias/ocorrencias.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { VisitantesService } from '../visitantes/visitantes.service';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { MudancasService } from '../mudancas/mudancas.service';
import type { CartaoAcao } from './acao-pendente.store';

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

/** Módulo registrado na auditoria para cada tipo de ação confirmada. */
const MODULO_POR_ACAO: Record<string, string> = {
  reserva_area: 'areas-sociais',
  ocorrencia: 'ocorrencias',
  visitante: 'visitantes',
  conta_morador: 'financeiro',
};

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
    private readonly acoes: AcaoPendenteStore,
    private readonly areasSociais: AreasSociaisService,
    private readonly ocorrencias: OcorrenciasService,
    private readonly auditoria: AuditoriaService,
    private readonly visitantes: VisitantesService,
    private readonly financeiro: FinanceiroService,
    private readonly mudancas: MudancasService,
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

    // O laço registra aqui a ação proposta durante o turno, se houver.
    const propostas: AcaoPendente[] = [];

    let resposta: string;
    try {
      resposta = await this.rodarLacoDeFerramentas(
        contents,
        instrucao,
        ctxFerramenta,
        propostas,
      );
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

    // Um card por turno: dois cards de uma vez confundiriam o usuário.
    // Proposta confirmável ganha da informativa — ela é que exige decisão.
    const pendente = propostas[propostas.length - 1];
    const informativo = ctxFerramenta.cartoes[ctxFerramenta.cartoes.length - 1];

    const acao: CartaoAcao | undefined = pendente
      ? {
          id: pendente.id,
          tipo: pendente.tipo,
          titulo: pendente.titulo,
          itens: pendente.itens,
          confirmavel: true,
        }
      : informativo;

    return { resposta, ...(acao && { acao }) };
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
    propostas: AcaoPendente[],
  ): Promise<string> {
    // Catálogo = leitura + ação, ambos já filtrados pelo papel.
    const declaracoes = [
      ...declaracoesPara(ctx.papel),
      ...acoesPara(ctx.papel).map((a) => ({
        name: a.nome,
        description: a.descricao,
        ...(a.parametros && { parameters: a.parametros }),
      })),
    ];

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
        const resultado = await this.executarFerramenta(chamada, ctx, propostas);
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
  private async executarFerramenta(
    chamada: ChamadaFerramenta,
    ctx: ContextoFerramenta,
    propostas: AcaoPendente[],
  ) {
    // Ferramenta de ação: valida e registra a proposta, NÃO escreve no banco.
    const acao = resolverAcao(chamada.name, ctx.papel);
    if (acao) {
      try {
        const { proposta, erro } = await acao.propor(chamada.args ?? {}, ctx);
        if (erro || !proposta) return { erro: erro ?? 'Não foi possível preparar essa ação.' };
        const registrada = this.acoes.criar(proposta);
        propostas.push(registrada);
        this.logger.log(
          `proposta ${registrada.tipo} ${registrada.id} (user#${ctx.idUser}, cond#${ctx.idCondominio})`,
        );
        // O modelo precisa saber que AINDA não aconteceu, para narrar certo.
        return {
          status: 'aguardando_confirmacao',
          resumo: registrada.itens,
          instrucao_para_voce:
            'A ação NÃO foi executada. O app vai mostrar um card de confirmação. Diga ao usuário o que você preparou e peça para ele confirmar no card.',
        };
      } catch (e: any) {
        this.logger.error(`proposta ${chamada.name} falhou: ${e?.message ?? e}`);
        return { erro: 'Não foi possível preparar essa ação agora.' };
      }
    }

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

  // =========================================================================
  // Execução de ação confirmada
  // =========================================================================

  /**
   * Executa uma ação que o usuário confirmou no app.
   *
   * Tudo é reconferido aqui, sem confiar em nada que o modelo produziu:
   *  - tenant e posse da proposta saem do JWT (o store compara);
   *  - a execução delega aos services de verdade, que reaplicam as próprias
   *    regras (o insertAgendamento, por exemplo, recusa reserva para
   *    apartamento que não é do morador);
   *  - marca como consumida ANTES de executar, então dois toques no botão não
   *    viram duas reservas.
   */
  async confirmarAcao(idCondominio: number, idAcao: string, user: JwtPayload) {
    if (!idAcao) throw new BadRequestException('Ação não informada.');
    await this.tenant.assertCondominio(idCondominio, user);

    const idUser = Number(user?.user?.id ?? user?.sub);
    const { acao, erro } = this.acoes.obterParaConfirmar(idAcao, idUser, idCondominio);
    if (erro || !acao) throw new BadRequestException(erro ?? 'Solicitação não encontrada.');

    this.acoes.marcarConsumida(acao.id);
    try {
      const mensagem = await this.executarAcao(acao, user);
      await this.registrarAuditoria(acao, user);
      return { ok: true, mensagem };
    } catch (e: any) {
      // Falhou de verdade: devolve ao estado pendente para o usuário tentar
      // de novo sem precisar refazer a conversa com o assistente.
      this.acoes.liberar(acao.id);
      this.logger.error(`execução de ${acao.tipo} ${acao.id} falhou: ${e?.message ?? e}`);
      if (e?.response && e?.status) throw e; // repassa BadRequest/Forbidden dos services
      throw new BadRequestException('Não foi possível concluir essa ação.');
    }
  }

  private async executarAcao(acao: AcaoPendente, user: JwtPayload): Promise<string> {
    const idUser = Number(user?.user?.id ?? user?.sub);
    const papel = this.papelDe(user);

    if (acao.tipo === 'reserva_area') {
      // typeAccess 'Morador' faz o service reaplicar o isolamento por
      // apartamento; agendarPeloSindico fica de fora de propósito, senão a
      // reserva se auto-aprovaria pulando a fila.
      await this.areasSociais.insertAgendamento(
        { ...acao.payload, user: idUser },
        idUser,
        papel,
        user,
      );
      return 'Reserva solicitada! Você acompanha o status em Áreas Sociais.';
    }

    if (acao.tipo === 'ocorrencia') {
      await this.ocorrencias.create({
        descricao: acao.payload.descricao,
        tipo: acao.payload.tipo ?? undefined,
        id_condominio: acao.idCondominio,
        user: idUser,
      } as any);
      return 'Ocorrência aberta! Você acompanha as respostas em Ocorrências.';
    }

    if (acao.tipo === 'visitante') {
      // assertUsuarioNoCondominio é a mesma checagem que a rota REST faz antes
      // de criar — o vínculo é reconferido, não herdado da proposta.
      await this.visitantes.assertUsuarioNoCondominio(acao.idCondominio, user);
      await this.visitantes.create(
        { ...acao.payload, id_condominio: acao.idCondominio } as any,
        user,
      );
      return 'Visitante cadastrado! Ele já aparece em Visitantes com o código de acesso.';
    }

    if (acao.tipo === 'conta_morador') {
      // insertMoradorConta grava sempre em id_usuario = idUser: a conta é do
      // próprio morador, nunca de outro. Passa o user para o vínculo com
      // acao.idCondominio ser reconferido, e não herdado da proposta salva.
      await this.financeiro.insertMoradorConta(idUser, acao.idCondominio, acao.payload, user);
      return acao.payload.pago === 1
        ? 'Conta lançada como paga! Ela já aparece no seu Financeiro.'
        : 'Conta lançada! Ela já aparece no seu Financeiro.';
    }

    if (acao.tipo === 'mudanca') {
      // create grava status 'pendente' — a mudança só vale depois que o
      // síndico aprovar na tela de Mudanças. Passar o user faz o service
      // reconferir o vínculo com acao.idCondominio, em vez de herdá-lo da
      // proposta salva, como no ramo de visitante.
      await this.mudancas.create(
        {
          data: acao.payload.data,
          hora_inicio: acao.payload.hora_inicio,
          id_apartamento: acao.payload.id_apartamento,
          id_condominio: acao.idCondominio,
          user: idUser,
        },
        user,
      );
      return 'Mudança solicitada! Ela fica pendente até o síndico aprovar — você acompanha o status em Mudanças.';
    }

    throw new BadRequestException('Tipo de ação desconhecido.');
  }

  private async registrarAuditoria(acao: AcaoPendente, user: JwtPayload) {
    try {
      await this.auditoria.registrar({
        id_condominio: acao.idCondominio,
        usuario_nome: user?.nome ?? 'Usuário do app',
        acao: 'CREATE',
        modulo: MODULO_POR_ACAO[acao.tipo] ?? acao.tipo,
        entidade_id: 0,
        descricao: `${acao.titulo} via assistente IA — ${acao.itens
          .map((i) => `${i.rotulo}: ${i.valor}`)
          .join('; ')}`,
      });
    } catch (e: any) {
      // Auditoria é registro, não pode derrubar a ação já executada.
      this.logger.warn(`auditoria da ação ${acao.id} falhou: ${e?.message ?? e}`);
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
      cartoes: [],
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

    // 2. Funcionários — todos os papéis (Geral + Portaria), só nome + função.
    try {
      const [funcsGerais, funcsPortaria] = await Promise.all([
        this.prisma.funcionarios.findMany({
          where: { id_condominio: idCondominio },
          select: { id: true, nome: true, funcao: true, cargo: true },
          orderBy: { nome: 'asc' },
        }),
        this.prisma.funcionarios_Portaria.findMany({
          where: { id_condominio: idCondominio, ativo: 1 },
          select: { id: true, nome: true, turno: true },
          orderBy: { nome: 'asc' },
        }),
      ]);

      const map = new Map<string, string>();

      for (const f of funcsGerais) {
        if (f.nome && f.nome.trim()) {
          map.set(f.nome.trim().toLowerCase(), f.funcao || f.cargo || 'Funcionário');
        }
      }

      for (const f of funcsPortaria) {
        if (f.nome && f.nome.trim()) {
          const key = f.nome.trim().toLowerCase();
          if (!map.has(key)) {
            map.set(key, f.turno ? `Porteiro (${f.turno})` : 'Porteiro');
          }
        }
      }

      const lista = Array.from(map.entries()).map(([nomeKey, funcao]) => {
        const originalGeral = funcsGerais.find((f) => f.nome?.trim().toLowerCase() === nomeKey);
        const originalPortaria = funcsPortaria.find((f) => f.nome?.trim().toLowerCase() === nomeKey);
        const nome = originalGeral?.nome || originalPortaria?.nome || nomeKey;
        return `- ${nome}${funcao ? ` — ${funcao}` : ''}`;
      });

      if (lista.length) {
        blocos.push('### Funcionários\n' + lista.join('\n'));
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
          : 'morador (pode consultar informações gerais do condomínio, regras, comunicados, áreas sociais e funcionários do condomínio)';

    const docsTxt = args.trechosDocs?.length
      ? args.trechosDocs.map((t, i) => `[Documento ${i + 1}]\n${t}`).join('\n\n')
      : '(nenhum trecho de ata/documento relevante para esta pergunta)';

    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    return `Você é o Click IA, o assistente do condomínio dentro do app Click. Responda em português do Brasil, de forma clara, cordial e objetiva.

Hoje é ${hoje}. O usuário atual é ${papelDesc}.

- Você tem FERRAMENTAS para consultar os dados do condomínio (contar_moradores, contar_funcionarios, listar_funcionarios, etc). Sempre que a pergunta pedir algo, CHAME a ferramenta apropriada ou consulte os dados do contexto em vez de dizer que não tem acesso.
- A lista e contagem de funcionários do condomínio (portaria, limpeza, manutenção) É uma informação aberta a todos os moradores. Para responder quantos funcionários existem, use a ferramenta contar_funcionarios ou consulte o bloco "### Funcionários" abaixo. Nunca diga que não tem acesso à listagem de funcionários.
- Para perguntas de quantidade ("quantos moradores", "quantas unidades"), use as ferramentas de contagem. Não tente contar itens de uma lista.
- Para AGIR (reservar área, abrir ocorrência) use as ferramentas propor_*. Elas NÃO executam: preparam um card que o morador confirma na tela. Depois de propor, diga em uma frase o que preparou e peça para ele confirmar no card.
- Você só enxerga as ferramentas permitidas para este perfil. Se uma consulta não for possível, explique de forma simples e sugira procurar o síndico ou a portaria — nunca afirme que o dado não existe.
- Não invente dados. Só afirme o que veio do contexto ou do resultado das ferramentas.

COMO ESCREVER (importante):
- Você fala com um morador no celular, não escreve relatório. Tom cordial e direto, frases curtas.
- Responda o essencial primeiro, em uma frase. Só detalhe depois, se ajudar.
- NÃO use títulos (#), tabelas, blocos de código nem emoji.
- Use **negrito** só no dado que importa (um valor, uma data, um nome). No máximo um destaque por linha — texto cheio de negrito cansa.
- Listas só quando houver 3 itens ou mais, uma linha por item começando com "- ". Para um ou dois itens, escreva em frase.
- Não repita o que o card de confirmação já mostra; ele aparece logo abaixo da sua resposta.
- Se o resultado tiver muitos itens, dê o total e cite os mais relevantes em vez de listar tudo.

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

  /**
   * Indexa UM documento — chamado logo após o upload.
   *
   * Antes, indexar só acontecia pelo endpoint manual de reindexação, que
   * nenhuma tela chamava: a ata subia e o assistente nunca via o conteúdo.
   */
  async indexarDocumentoPorId(idCondominio: number, idDoc: number) {
    if (!this.prisma.isConnected) return { skipped: true, motivo: 'sem_banco' };
    const doc = await this.prisma.documentos.findFirst({
      where: { id: idDoc, id_condominio: idCondominio },
      select: { id: true, nome: true, link_doc: true, is_ata: true },
    });
    if (!doc) return { skipped: true, motivo: 'nao_encontrado' };
    return this.reindexDocumento(idCondominio, doc);
  }

  /** Descarta os trechos de um documento apagado, para não responder por ele. */
  async removerIndiceDocumento(idCondominio: number, idDoc: number) {
    if (!this.prisma.isConnected) return;
    await this.prisma.rag_Embeddings.deleteMany({
      where: { id_condominio: idCondominio, source_id: idDoc },
    });
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
    //
    // API da v2: o módulo exporta a classe PDFParse. Na v1 o próprio require
    // era a função — chamá-lo assim estourava "pdfParse is not a function" a
    // cada documento, e o erro era engolido como "extracao_falhou".
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const data = await parser.getText();
      return data?.text ?? '';
    } finally {
      // Libera o worker do pdf.js; sem isso o processo acumula handles a cada
      // documento indexado.
      await parser.destroy().catch(() => undefined);
    }
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

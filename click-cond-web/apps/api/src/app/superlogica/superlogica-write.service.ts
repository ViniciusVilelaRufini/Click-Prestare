import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SuperlogicaClient } from './superlogica.client';
import { SuperlogicaService } from './superlogica.service';
import { SuperlogicaContato, SuperlogicaUnidade } from './superlogica.types';

/**
 * Envio de proprietário/morador do Clique para a Superlógica — o lado de
 * escrita da integração.
 *
 * É a única coisa que o Clique grava no ERP. Cobrança, unidade e condomínio
 * continuam sendo só leitura. Ver INTEGRACAO_SUPERLOGICA.md.
 *
 * Nada acontece sem `Condominios.superlogica_escrita = 1`, ligado condomínio a
 * condomínio no CRM.
 */

/**
 * ID_LABEL_TRES — tipo de responsável, na tabela da Superlógica.
 *
 * A escolha importa mais do que parece: no ERP, cada contato marcado como
 * PROPRIETÁRIO vira uma linha própria da unidade na tela de Unidades. Mandar
 * familiar como proprietário multiplicaria as linhas do prédio e diria que a
 * unidade tem vários donos.
 */
const LABEL_PROPRIETARIO_RESIDENTE = 1;
const LABEL_DEPENDENTE = 4;
const LABEL_RESIDENTE = 7;

/** ID_TIPOCONTATO_TCON — 1 = condômino. */
const TIPO_CONTATO_CONDOMINO = 1;

/**
 * ID_TIPORESP_TRES — quem recebe cobrança.
 *
 * 4 = NÃO RECEBER COBRANÇAS, de propósito. Cadastrar alguém no app não pode
 * mudar para quem o boleto é emitido: isso é decisão financeira da
 * administradora, tomada no ERP. O contato entra como cadastro, não como
 * sacado.
 */
const TIPORESP_NAO_RECEBER_COBRANCAS = 4;

export interface PayloadCondomino {
  [campo: string]: string | number;
}

export interface ResultadoEnvio {
  enviado: boolean;
  motivo?: string;
  idContatoSuperlogica?: number;
}

@Injectable()
export class SuperlogicaWriteService {
  private readonly logger = new Logger(SuperlogicaWriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: SuperlogicaClient,
    private readonly superlogica: SuperlogicaService,
  ) {}

  /**
   * Monta o corpo do PUT /unidades/post.
   *
   * Os contatos que já estão na unidade são reenviados por `ID_CONTATO_CON` —
   * a documentação diz que, com esse campo, os demais são desconsiderados, ou
   * seja, ele referencia o contato existente em vez de recriá-lo.
   *
   * Reenviar todos é a proteção contra a dúvida central deste endpoint: ele se
   * chama "Editar unidade", e não está documentado se a lista de contatos é
   * substituída ou acrescida. Mandando a lista completa, o resultado é o mesmo
   * nas duas hipóteses — e ninguém perde morador.
   */
  static montarPayload(
    idCondominioSuperlogica: number,
    idUnidadeSuperlogica: number,
    contatosExistentes: SuperlogicaContato[],
    novo: {
      nome: string;
      email?: string | null;
      telefone?: string | null;
      documento?: string | null;
      tipo?: string | null;
    },
    hoje = new Date(),
  ): PayloadCondomino {
    const payload: PayloadCondomino = {
      ID_CONDOMINIO_COND: idCondominioSuperlogica,
      ID_UNIDADE_UNI: idUnidadeSuperlogica,
    };

    contatosExistentes.forEach((c, i) => {
      payload[`contatos[${i}][ID_CONTATO_CON]`] = c.id_contato_con;
    });

    const i = contatosExistentes.length;

    payload[`contatos[${i}][ST_NOME_CON]`] = novo.nome;
    payload[`contatos[${i}][DT_ENTRADA_RES]`] = SuperlogicaClient.formatarData(hoje);
    payload[`contatos[${i}][ID_TIPOCONTATO_TCON]`] = TIPO_CONTATO_CONDOMINO;
    payload[`contatos[${i}][ID_LABEL_TRES]`] = SuperlogicaWriteService.labelDoTipo(novo.tipo);
    payload[`contatos[${i}][ID_TIPORESP_TRES]`] = TIPORESP_NAO_RECEBER_COBRANCAS;

    if (novo.email) payload[`contatos[${i}][ST_EMAIL_CON]`] = novo.email;
    if (novo.telefone) payload[`contatos[${i}][ST_TELEFONE_CON]`] = novo.telefone;
    if (novo.documento) payload[`contatos[${i}][ST_CPF_CON]`] = novo.documento;

    return payload;
  }

  /**
   * Traduz o vínculo do Clique para o rótulo de responsável do ERP.
   *
   * O app usa 'proprietario', 'inquilino' e 'membro' (familiar cadastrado pelo
   * próprio morador). Mandar membro como proprietário faria a unidade aparecer
   * com vários donos na tela de Unidades do ERP — cada proprietário vira uma
   * linha própria lá.
   */
  static labelDoTipo(tipo?: string | null): number {
    const t = (tipo ?? '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();

    if (t.includes('inquilin')) return LABEL_RESIDENTE;
    if (t.includes('membro') || t.includes('familiar') || t.includes('dependente')) return LABEL_DEPENDENTE;
    return LABEL_PROPRIETARIO_RESIDENTE;
  }

  /** Só dígitos, para comparar CPF que veio formatado de um lado e não do outro. */
  private static soDigitos(valor?: string | null): string {
    return (valor ?? '').replace(/\D/g, '');
  }

  /**
   * Valida CPF pelo dígito verificador (módulo 11).
   *
   * A Superlógica recusa CPF inválido — e recusa devolvendo HTTP 200 com o erro
   * no corpo, o que fazia a recusa passar despercebida. Checar aqui transforma
   * isso numa mensagem clara ("CPF inválido") em vez de um envio que não
   * acontece por motivo nenhum aparente.
   *
   * Aceita vazio: CPF é opcional no cadastro, e contato sem CPF o ERP aceita.
   */
  static cpfValido(valor?: string | null): boolean {
    const cpf = SuperlogicaWriteService.soDigitos(valor);
    if (!cpf) return true;
    if (cpf.length !== 11) return false;
    // Sequências repetidas passam no cálculo mas não são CPF.
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    const digito = (ate: number): number => {
      let soma = 0;
      for (let i = 0; i < ate; i++) soma += Number(cpf[i]) * (ate + 1 - i);
      const resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
    };

    return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
  }

  /**
   * Procura o contato na unidade por CPF ou e-mail.
   *
   * Serve para dois momentos: antes de enviar (não duplicar quem já está lá) e
   * depois (descobrir o id do contato recém-criado, já que a resposta do ERP
   * não o devolve de forma confiável).
   */
  static acharContato(
    unidade: SuperlogicaUnidade | undefined,
    alvo: { email?: string | null; documento?: string | null },
  ): SuperlogicaContato | undefined {
    const doc = SuperlogicaWriteService.soDigitos(alvo.documento);
    const email = (alvo.email ?? '').trim().toLowerCase();

    return (unidade?.contatos ?? []).find((c) => {
      if (doc && SuperlogicaWriteService.soDigitos(c.st_cpf_con) === doc) return true;
      if (email && (c.st_email_con ?? '').trim().toLowerCase() === email) return true;
      return false;
    });
  }

  private async carregarContexto(idMorador: number) {
    const morador = await this.prisma.moradores.findUnique({
      where: { id: idMorador },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        documento: true,
        tipo: true,
        bloco: true,
        apartamento: true,
        id_user: true,
        id_condominio: true,
        id_superlogica_con: true,
      },
    });
    if (!morador?.id_condominio) return null;

    const condominio = await this.prisma.condominios.findUnique({
      where: { id: morador.id_condominio },
      select: { id: true, id_superlogica_cond: true, superlogica_escrita: true },
    });

    const { apartamento, motivoApartamento } = await this.resolverApartamento({
      ...morador,
      id_condominio: morador.id_condominio,
    });

    return { morador, condominio, apartamento, motivoApartamento };
  }

  /**
   * Descobre em qual apartamento o morador mora — o passo que decide em qual
   * unidade do ERP real o contato vai ser gravado.
   *
   * O vínculo por ID (`Apartamentos_Users`) vem primeiro porque o casamento por
   * texto é frágil de um jeito perigoso: renomear o apartamento quebra a
   * resolução em silêncio, e morador com `apartamento` vazio viraria
   * `{ bloco: null, apto: null }`, que casa com QUALQUER linha de bloco/apto
   * nulos do condomínio (o unique `un_apto_cond` não impede duplicatas porque
   * o MySQL trata NULL como distinto) — e aí o morador nasce numa unidade
   * errada do ERP.
   *
   * Empate não se resolve no chute: mandar o morador para o apartamento errado
   * é pior que não mandar, então a ambiguidade vira recusa com motivo.
   */
  private async resolverApartamento(morador: {
    id_user: number | null;
    id_condominio: number;
    bloco: string | null;
    apartamento: string | null;
  }): Promise<{
    apartamento: { id: number; id_superlogica_uni: number | null } | null;
    motivoApartamento?: string;
  }> {
    if (morador.id_user != null) {
      const vinculos = await this.prisma.apartamentos_Users.findMany({
        where: { id_user: morador.id_user, apartamento: { id_condominio: morador.id_condominio } },
        select: { apartamento: { select: { id: true, id_superlogica_uni: true } } },
      });

      const aptos = vinculos.map((v) => v.apartamento).filter(Boolean);
      // Vínculo que já aponta para uma unidade do ERP é o único que interessa
      // ao envio; se só um está nessa condição, o empate se desfaz sozinho.
      const comUnidade = aptos.filter((a) => a.id_superlogica_uni != null);
      const candidatos = comUnidade.length ? comUnidade : aptos;

      if (candidatos.length === 1) return { apartamento: candidatos[0] };
      if (candidatos.length > 1) {
        return {
          apartamento: null,
          motivoApartamento: 'morador vinculado a mais de um apartamento — envie pelo painel',
        };
      }
    }

    // Sem vínculo por ID sobra o texto — mas nunca com apto vazio, que é o caso
    // que casava NULL/NULL e escrevia numa unidade qualquer.
    if (!(morador.apartamento ?? '').trim()) {
      return { apartamento: null, motivoApartamento: 'morador sem apartamento identificado' };
    }

    const apartamento = await this.prisma.apartamentos.findFirst({
      where: {
        id_condominio: morador.id_condominio,
        bloco: morador.bloco || null,
        apto: morador.apartamento,
      },
      select: { id: true, id_superlogica_uni: true },
    });

    return { apartamento };
  }

  /**
   * Fila por unidade: dois envios para a MESMA unidade nunca se sobrepõem.
   *
   * Sem isso, dois envios simultâneos leem a mesma lista de contatos e cada um
   * faz o PUT com a lista que leu — o segundo sem o contato criado pelo
   * primeiro. Se o endpoint "Editar unidade" substituir a lista (a hipótese que
   * a §7.1 declara não resolvida, e contra a qual reenviar todos os contatos é
   * justamente a proteção), o segundo PUT apaga um morador real do ERP.
   *
   * Premissa: o Railway roda UMA réplica, então um mutex em processo basta. Com
   * múltiplas réplicas isso precisa virar lock no banco — o mutex em memória de
   * cada réplica não veria as outras.
   */
  private readonly filasPorUnidade = new Map<string, Promise<unknown>>();

  private async naFilaDaUnidade<T>(chave: string, tarefa: () => Promise<T>): Promise<T> {
    const anterior = this.filasPorUnidade.get(chave) ?? Promise.resolve();
    // O `catch` é do encadeamento, não do resultado: um envio que falhou não
    // pode travar a fila de quem vem atrás.
    const atual = anterior.catch(() => undefined).then(tarefa);
    this.filasPorUnidade.set(chave, atual);

    try {
      return await atual;
    } finally {
      // Libera a chave quando ninguém entrou na fila depois de mim — senão o
      // Map cresce uma entrada por unidade e nunca encolhe.
      if (this.filasPorUnidade.get(chave) === atual) this.filasPorUnidade.delete(chave);
    }
  }

  /**
   * Envia um morador do Clique para a unidade correspondente no ERP.
   *
   * Best-effort por decisão: falar com a Superlógica não pode derrubar o
   * cadastro de morador no Clique. Toda recusa devolve um motivo, que fica no
   * log e na auditoria, em vez de virar exceção na cara do usuário do app.
   *
   * `unidadesPreCarregadas` é a lista de unidades do condomínio já lida por
   * quem chama (hoje só `reenviarPendentes`, para não varrer o condomínio
   * inteiro uma vez por morador). É OPCIONAL de propósito: sem ela o
   * comportamento é o de sempre, e os gatilhos automáticos não mudam.
   */
  async enviarMorador(idMorador: number, unidadesPreCarregadas?: SuperlogicaUnidade[]): Promise<ResultadoEnvio> {
    const ctx = await this.carregarContexto(idMorador);
    if (!ctx) return { enviado: false, motivo: 'morador sem condomínio' };

    const { morador, condominio, apartamento, motivoApartamento } = ctx;

    if (condominio?.superlogica_escrita !== 1) {
      return { enviado: false, motivo: 'escrita desligada para este condomínio' };
    }
    if (condominio?.id_superlogica_cond == null) {
      return { enviado: false, motivo: 'condomínio não vinculado' };
    }
    if (!apartamento) {
      return { enviado: false, motivo: motivoApartamento ?? 'apartamento não encontrado' };
    }
    if (!apartamento.id_superlogica_uni) {
      // Sem unidade correspondente não há onde pendurar o contato. Criar a
      // unidade no ERP seria escrita muito além do combinado.
      return { enviado: false, motivo: 'apartamento sem unidade vinculada no ERP' };
    }
    if (morador.id_superlogica_con != null) {
      return { enviado: false, motivo: 'já enviado anteriormente' };
    }
    if (!SuperlogicaWriteService.cpfValido(morador.documento)) {
      // Sem esta checagem, o ERP recusa com HTTP 200 e a falha vira silêncio.
      // Melhor dizer o que está errado e onde consertar.
      return {
        enviado: false,
        motivo: `CPF inválido ("${morador.documento}") — corrija no cadastro do morador e reenvie`,
      };
    }

    // Daqui para baixo é seção crítica: ler os contatos, montar o payload com
    // eles e escrever tem que ser indivisível para a mesma unidade.
    return this.naFilaDaUnidade(
      `${condominio.id_superlogica_cond}:${apartamento.id_superlogica_uni}`,
      () =>
        this.escreverNaUnidade(
          morador,
          condominio.id_superlogica_cond as number,
          apartamento.id_superlogica_uni as number,
          unidadesPreCarregadas,
        ),
    );
  }

  /**
   * O que roda com a unidade travada: lê os contatos, monta o payload, escreve
   * e confirma.
   *
   * A leitura acontece AQUI dentro, e não antes das validações, porque uma
   * leitura feita fora do lock já pode estar obsoleta quando o PUT sai — que é
   * exatamente como um contato real some da unidade.
   */
  private async escreverNaUnidade(
    morador: {
      id: number;
      nome: string;
      email: string | null;
      telefone: string | null;
      documento: string | null;
      tipo: string | null;
    },
    idCondominioSuperlogica: number,
    idUnidadeSuperlogica: number,
    unidadesPreCarregadas?: SuperlogicaUnidade[],
  ): Promise<ResultadoEnvio> {
    const idMorador = morador.id;

    // Com lista pré-carregada, quem chama é responsável por mantê-la em dia —
    // `reenviarPendentes` a atualiza com o resultado de cada envio, logo abaixo.
    const unidades = unidadesPreCarregadas ?? (await this.superlogica.listarUnidades(idCondominioSuperlogica));
    const unidade = unidades.find((u) => Number(u.id_unidade_uni) === idUnidadeSuperlogica);
    if (!unidade) {
      return { enviado: false, motivo: 'unidade não encontrada no ERP' };
    }

    // Já existe lá? Então só amarra os dois lados — reenviar criaria um contato
    // duplicado na unidade.
    const jaExiste = SuperlogicaWriteService.acharContato(unidade, morador);
    if (jaExiste) {
      await this.prisma.moradores.update({
        where: { id: morador.id },
        data: { id_superlogica_con: Number(jaExiste.id_contato_con) },
      });
      return { enviado: false, motivo: 'contato já existia no ERP', idContatoSuperlogica: Number(jaExiste.id_contato_con) };
    }

    const payload = SuperlogicaWriteService.montarPayload(
      idCondominioSuperlogica,
      idUnidadeSuperlogica,
      unidade.contatos ?? [],
      morador,
    );

    // Guardado ANTES da escrita: é como se confirma que o contato nasceu, sem
    // depender de CPF ou e-mail para reconhecê-lo depois.
    const idsAntes = new Set((unidade.contatos ?? []).map((c) => String(c.id_contato_con)));

    const resposta = await this.client.putEscritaRestrita<any>('unidades/post', payload);

    // A Superlógica responde HTTP 200 mesmo quando recusa a operação — o
    // veredito de verdade está no corpo, em `status`/`msg`. Sem olhar isso, uma
    // recusa passaria por sucesso.
    const item = Array.isArray(resposta) ? resposta[0] : resposta;
    const statusErp = String(item?.status ?? '');
    const msgErp = String(item?.msg ?? '').trim();

    if (statusErp && statusErp !== '200') {
      this.logger.error(`Morador ${idMorador}: ERP recusou (status ${statusErp}): ${msgErp}`);
      return { enviado: false, motivo: `ERP recusou (${statusErp}): ${msgErp || 'sem mensagem'}` };
    }

    // Relê e procura um id que não existia antes. Confirma de fato, e funciona
    // para morador sem CPF nem e-mail — que o casamento por dados não acharia.
    const depois = await this.superlogica.listarUnidades(idCondominioSuperlogica);
    const unidadeDepois = depois.find((u) => Number(u.id_unidade_uni) === idUnidadeSuperlogica);
    const novo = (unidadeDepois?.contatos ?? []).find((c) => !idsAntes.has(String(c.id_contato_con)));

    // A lista pré-carregada envelheceu no instante do PUT. Trocar a unidade
    // pela versão recém-lida é de graça (a leitura já aconteceu para confirmar)
    // e é o que faz o próximo morador da MESMA unidade montar o payload com
    // este contato dentro — sem isso o reaproveitamento da lista reintroduziria
    // a corrida dentro do próprio laço de `reenviarPendentes`.
    if (unidadesPreCarregadas && unidadeDepois) {
      const i = unidadesPreCarregadas.findIndex((u) => Number(u.id_unidade_uni) === idUnidadeSuperlogica);
      if (i >= 0) unidadesPreCarregadas[i] = unidadeDepois;
    }

    if (!novo) {
      // O ERP disse OK e nada apareceu. Não dá para chamar isso de enviado:
      // marcar assim esconderia o problema e ainda impediria uma nova
      // tentativa, porque o morador deixaria de ser pendente.
      this.logger.error(
        `Morador ${idMorador}: ERP respondeu "${msgErp || statusErp}" mas nenhum contato novo apareceu na unidade ${idUnidadeSuperlogica}.`,
      );
      return {
        enviado: false,
        motivo: `ERP respondeu "${msgErp || statusErp || 'sem corpo'}" mas nenhum contato novo apareceu na unidade ${idUnidadeSuperlogica}`,
      };
    }

    await this.prisma.moradores.update({
      where: { id: morador.id },
      data: { id_superlogica_con: Number(novo.id_contato_con) },
    });

    this.logger.log(
      `Morador ${idMorador} enviado à Superlógica: contato ${novo.id_contato_con} na unidade ${idUnidadeSuperlogica}.`,
    );

    return { enviado: true, idContatoSuperlogica: Number(novo.id_contato_con) };
  }

  /**
   * Envia ao ERP todos os moradores do condomínio que ainda não subiram.
   *
   * Existe por dois motivos. Primeiro, o passivo: morador cadastrado antes de a
   * escrita ser ligada não sobe sozinho, porque o envio acontece no momento do
   * cadastro. Segundo, e mais importante, o envio automático é fire-and-forget
   * — a falha vai para o log e ninguém vê. Aqui o resultado de cada um volta
   * para a tela, então um problema aparece em vez de sumir.
   */
  async reenviarPendentes(idCondominioClique: number): Promise<{
    total: number;
    enviados: number;
    resultados: { id: number; nome: string; enviado: boolean; motivo?: string }[];
  }> {
    const pendentes = await this.prisma.moradores.findMany({
      where: { id_condominio: idCondominioClique, id_superlogica_con: null },
      select: { id: true, nome: true },
      orderBy: { id: 'asc' },
    });

    const resultados: { id: number; nome: string; enviado: boolean; motivo?: string }[] = [];
    let enviados = 0;

    // Uma leitura de entrada para o lote inteiro. Cada envio varria o
    // condomínio de 50 em 50 duas vezes: 300 pendentes viravam milhares de
    // requisições sequenciais dentro de UMA requisição HTTP, que estoura o
    // gateway — e o operador reapertando o botão depois do timeout multiplicava
    // a corrida. A releitura de confirmação de cada envio continua existindo:
    // é ela que prova que o contato nasceu.
    const unidades = await this.carregarUnidadesDoCondominio(idCondominioClique);

    for (const m of pendentes) {
      try {
        const r = await this.enviarMorador(m.id, unidades);
        if (r.enviado) enviados++;
        resultados.push({ id: m.id, nome: m.nome, enviado: r.enviado, motivo: r.motivo });
      } catch (err: any) {
        // Um morador com problema não pode parar a fila — e o motivo precisa
        // chegar à tela, que é o ponto deste método.
        this.logger.error(`Reenvio do morador ${m.id} falhou: ${err?.message ?? err}`);
        resultados.push({ id: m.id, nome: m.nome, enviado: false, motivo: err?.message ?? 'erro' });
      }
    }

    return { total: pendentes.length, enviados, resultados };
  }

  /**
   * Lê as unidades do condomínio uma vez, para o lote.
   *
   * Devolve `undefined` em vez de estourar: sem a lista, cada envio volta a ler
   * por conta própria e a falha aparece morador a morador na tela, que é o
   * comportamento de sempre — o lote não pode morrer inteiro por causa da
   * leitura de entrada.
   *
   * Com escrita desligada ou condomínio sem vínculo nenhum envio vai sair, e
   * varrer o condomínio inteiro à toa seria só carga no ERP.
   */
  private async carregarUnidadesDoCondominio(idCondominioClique: number): Promise<SuperlogicaUnidade[] | undefined> {
    const condominio = await this.prisma.condominios.findUnique({
      where: { id: idCondominioClique },
      select: { id_superlogica_cond: true, superlogica_escrita: true },
    });
    if (condominio?.superlogica_escrita !== 1) return undefined;
    if (condominio.id_superlogica_cond == null) return undefined;

    try {
      return await this.superlogica.listarUnidades(condominio.id_superlogica_cond);
    } catch (err: any) {
      this.logger.error(`Leitura das unidades do condomínio ${idCondominioClique} falhou: ${err?.message ?? err}`);
      return undefined;
    }
  }

  /**
   * Mostra exatamente o que seria enviado, sem enviar.
   *
   * Existe para conferir o payload contra o ERP antes de ligar a escrita num
   * condomínio de verdade.
   */
  async preverEnvio(idMorador: number): Promise<{ payload: PayloadCondomino | null; motivo?: string }> {
    const ctx = await this.carregarContexto(idMorador);
    if (!ctx) return { payload: null, motivo: 'morador sem condomínio' };

    const { morador, condominio, apartamento, motivoApartamento } = ctx;
    if (condominio?.id_superlogica_cond == null) return { payload: null, motivo: 'condomínio não vinculado' };
    if (!apartamento) return { payload: null, motivo: motivoApartamento ?? 'apartamento não encontrado' };
    if (!apartamento.id_superlogica_uni) return { payload: null, motivo: 'apartamento sem unidade vinculada no ERP' };

    const unidades = await this.superlogica.listarUnidades(condominio.id_superlogica_cond);
    const unidade = unidades.find((u) => Number(u.id_unidade_uni) === apartamento.id_superlogica_uni);

    return {
      payload: SuperlogicaWriteService.montarPayload(
        condominio.id_superlogica_cond,
        apartamento.id_superlogica_uni,
        unidade?.contatos ?? [],
        morador,
      ),
    };
  }
}

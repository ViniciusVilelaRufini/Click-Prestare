import { SuperlogicaWriteService } from './superlogica-write.service';
import { SuperlogicaRotaBloqueadaError, SuperlogicaClient } from './superlogica.client';

/**
 * Envio de morador do Clique para a Superlógica — a ÚNICA escrita da
 * integração, e a que mexe em cadastro real da administradora.
 *
 * Nenhum teste toca a rede.
 */
describe('SuperlogicaWriteService — montagem do payload', () => {
  const contato = (id: string, nome: string, cpf = '', email = '') => ({
    id_contato_con: id,
    st_nome_con: nome,
    st_cpf_con: cpf,
    st_email_con: email,
  });

  it('reenvia os contatos existentes por ID antes de acrescentar o novo', () => {
    // O endpoint se chama "Editar unidade" e não está documentado se a lista de
    // contatos é substituída ou acrescida. Mandando todos, o resultado é o
    // mesmo nas duas hipóteses — e ninguém perde morador.
    const payload = SuperlogicaWriteService.montarPayload(
      43,
      1901,
      [contato('500', 'Vizinho Um'), contato('501', 'Vizinho Dois')],
      { nome: 'Novo Proprietário' },
      new Date(2026, 7, 27),
    );

    expect(payload['contatos[0][ID_CONTATO_CON]']).toBe('500');
    expect(payload['contatos[1][ID_CONTATO_CON]']).toBe('501');
    expect(payload['contatos[2][ST_NOME_CON]']).toBe('Novo Proprietário');
  });

  it('identifica condomínio e unidade', () => {
    const payload = SuperlogicaWriteService.montarPayload(43, 1901, [], { nome: 'X' });

    expect(payload['ID_CONDOMINIO_COND']).toBe(43);
    expect(payload['ID_UNIDADE_UNI']).toBe(1901);
  });

  it('NÃO inscreve o novo contato para receber cobrança', () => {
    // 4 = NÃO RECEBER COBRANÇAS. Cadastrar alguém no app não pode mudar para
    // quem o boleto é emitido — isso é decisão financeira, tomada no ERP.
    const payload = SuperlogicaWriteService.montarPayload(43, 1901, [], { nome: 'X' });

    expect(payload['contatos[0][ID_TIPORESP_TRES]']).toBe(4);
  });

  it('marca cada vínculo com o rótulo certo', () => {
    // Não é detalhe: no ERP, cada contato marcado como PROPRIETÁRIO vira uma
    // linha própria da unidade na tela de Unidades. Mandar familiar como
    // proprietário faria a unidade aparecer com vários donos.
    const label = (tipo?: string) =>
      SuperlogicaWriteService.montarPayload(43, 1901, [], { nome: 'X', tipo })['contatos[0][ID_LABEL_TRES]'];

    expect(label('proprietario')).toBe(1); // proprietário residente
    expect(label('Proprietário')).toBe(1); // com acento e maiúscula
    expect(label('inquilino')).toBe(7); // residente
    expect(label('membro')).toBe(4); // dependente
    expect(label('Membro')).toBe(4);
    expect(label(undefined)).toBe(1); // sem tipo, assume proprietário
  });

  it('usa a data de entrada no formato do ERP', () => {
    // 27/08/2026 precisa virar 08/27/2026 — o ERP é americano.
    const payload = SuperlogicaWriteService.montarPayload(43, 1901, [], { nome: 'X' }, new Date(2026, 7, 27));

    expect(payload['contatos[0][DT_ENTRADA_RES]']).toBe('08/27/2026');
  });

  it('omite campos opcionais vazios em vez de mandar string vazia', () => {
    const payload = SuperlogicaWriteService.montarPayload(43, 1901, [], {
      nome: 'X',
      email: null,
      telefone: '',
      documento: undefined,
    });

    expect(payload['contatos[0][ST_EMAIL_CON]']).toBeUndefined();
    expect(payload['contatos[0][ST_TELEFONE_CON]']).toBeUndefined();
    expect(payload['contatos[0][ST_CPF_CON]']).toBeUndefined();
  });
});

/**
 * A Superlógica recusa CPF inválido — e recusa devolvendo HTTP 200 com o erro
 * no corpo. Foi o que segurou o primeiro envio real: o morador tinha CPF de
 * números aleatórios e a recusa passou despercebida.
 */
describe('SuperlogicaWriteService — validação de CPF', () => {
  it('aceita CPF válido, com ou sem máscara', () => {
    // O que subiu de verdade no condomínio de teste.
    expect(SuperlogicaWriteService.cpfValido('52470445094')).toBe(true);
    expect(SuperlogicaWriteService.cpfValido('524.704.450-94')).toBe(true);
  });

  it('recusa dígito verificador errado', () => {
    expect(SuperlogicaWriteService.cpfValido('12345678900')).toBe(false);
    // O válido com o último dígito trocado.
    expect(SuperlogicaWriteService.cpfValido('52470445095')).toBe(false);
  });

  it('recusa sequência repetida', () => {
    // Passa no cálculo do módulo 11, mas não é CPF.
    expect(SuperlogicaWriteService.cpfValido('11111111111')).toBe(false);
  });

  it('recusa tamanho errado', () => {
    expect(SuperlogicaWriteService.cpfValido('1234567890')).toBe(false);
  });

  it('aceita vazio — CPF é opcional e o ERP aceita contato sem ele', () => {
    expect(SuperlogicaWriteService.cpfValido('')).toBe(true);
    expect(SuperlogicaWriteService.cpfValido(null)).toBe(true);
    expect(SuperlogicaWriteService.cpfValido(undefined)).toBe(true);
  });
});

describe('SuperlogicaWriteService — casamento de contato', () => {
  const unidade = {
    id_unidade_uni: '1901',
    contatos: [
      { id_contato_con: '500', st_nome_con: 'Fulano', st_cpf_con: '317.350.086-56', st_email_con: 'f@x.com' },
    ],
  } as any;

  it('acha por CPF ignorando formatação', () => {
    // Um lado grava "31735008656", o outro "317.350.086-56".
    const achado = SuperlogicaWriteService.acharContato(unidade, { documento: '31735008656' });

    expect(achado?.id_contato_con).toBe('500');
  });

  it('acha por e-mail ignorando caixa e espaços', () => {
    const achado = SuperlogicaWriteService.acharContato(unidade, { email: '  F@X.COM ' });

    expect(achado?.id_contato_con).toBe('500');
  });

  it('não casa quando não há CPF nem e-mail para comparar', () => {
    // Casar por nome seria pedir para vincular a pessoa errada.
    expect(SuperlogicaWriteService.acharContato(unidade, {})).toBeUndefined();
    expect(SuperlogicaWriteService.acharContato(unidade, { documento: '', email: '' })).toBeUndefined();
  });
});

describe('SuperlogicaWriteService — condições de envio', () => {
  function montar(opcoes: {
    superlogica_escrita?: number;
    id_superlogica_cond?: number | null;
    id_superlogica_uni?: number | null;
    id_superlogica_con?: number | null;
    documento?: string | null;
  }) {
    const put = jest.fn(async () => ({ status: '200' }));
    const update = jest.fn(async () => ({}));

    const prisma: any = {
      moradores: {
        findUnique: jest.fn(async () => ({
          id: 10,
          nome: 'Novo',
          email: 'n@x.com',
          telefone: null,
          // CPF válido: o ERP recusa inválido, e a checagem roda antes do PUT.
          documento: opcoes.documento === undefined ? '52470445094' : opcoes.documento,
          tipo: 'proprietario',
          bloco: 'a',
          apartamento: '1',
          id_condominio: 7,
          id_superlogica_con: opcoes.id_superlogica_con ?? null,
        })),
        update,
      },
      condominios: {
        findUnique: jest.fn(async () => ({
          id: 7,
          id_superlogica_cond: opcoes.id_superlogica_cond === undefined ? 43 : opcoes.id_superlogica_cond,
          superlogica_escrita: opcoes.superlogica_escrita ?? 1,
        })),
      },
      apartamentos: {
        findFirst: jest.fn(async () => ({
          id: 55,
          id_superlogica_uni: opcoes.id_superlogica_uni === undefined ? 1901 : opcoes.id_superlogica_uni,
        })),
      },
    };

    const superlogica = {
      listarUnidades: jest.fn(async () => [{ id_unidade_uni: '1901', contatos: [] }]),
    };

    const service = new SuperlogicaWriteService(prisma, { putEscritaRestrita: put } as any, superlogica as any);
    return { service, put, update };
  }

  it('não escreve quando a escrita está desligada no condomínio', async () => {
    // Default do sistema. Nenhum condomínio escreve até alguém ligar no CRM.
    const { service, put } = montar({ superlogica_escrita: 0 });

    const r = await service.enviarMorador(10);

    expect(put).not.toHaveBeenCalled();
    expect(r.enviado).toBe(false);
    expect(r.motivo).toContain('desligada');
  });

  it('não escreve em condomínio sem vínculo', async () => {
    const { service, put } = montar({ id_superlogica_cond: null });

    await service.enviarMorador(10);

    expect(put).not.toHaveBeenCalled();
  });

  it('não escreve quando o apartamento não tem unidade no ERP', async () => {
    // Criar a unidade no ERP seria escrita muito além do combinado.
    const { service, put } = montar({ id_superlogica_uni: null });

    const r = await service.enviarMorador(10);

    expect(put).not.toHaveBeenCalled();
    expect(r.motivo).toContain('sem unidade vinculada');
  });

  it('recusa antes de escrever quando o CPF é inválido', async () => {
    // Sem isso, o ERP recusaria com HTTP 200 e a falha viraria silêncio.
    const { service, put } = montar({ documento: '12345678900' });

    const r = await service.enviarMorador(10);

    expect(put).not.toHaveBeenCalled();
    expect(r.motivo).toContain('CPF inválido');
  });

  it('não reenvia morador já enviado', async () => {
    // Reenviar criaria contato duplicado na unidade a cada reedição.
    const { service, put } = montar({ id_superlogica_con: 500 });

    const r = await service.enviarMorador(10);

    expect(put).not.toHaveBeenCalled();
    expect(r.motivo).toContain('já enviado');
  });

  it('escreve quando tudo está no lugar', async () => {
    const { service, put } = montar({});

    await service.enviarMorador(10);

    expect(put).toHaveBeenCalledTimes(1);
    const [rota, payload] = put.mock.calls[0] as any[];
    expect(rota).toBe('unidades/post');
    expect(payload['ID_UNIDADE_UNI']).toBe(1901);
  });
});

/**
 * O envio precisa ser incapaz de dizer "enviado" sem que o contato exista.
 *
 * Aconteceu em produção: o CRM mostrou "1 de 1 enviado" e o ERP não tinha o
 * contato. Um sucesso falso é pior que uma falha — esconde o problema e ainda
 * impede nova tentativa, porque o morador deixa de ser pendente.
 */
describe('SuperlogicaWriteService — confirmação do envio', () => {
  function montar(opcoes: { resposta?: any; contatosDepois?: any[] }) {
    const update = jest.fn(async () => ({}));
    const prisma: any = {
      moradores: {
        findUnique: jest.fn(async () => ({
          id: 10,
          nome: 'Caio',
          email: null,
          telefone: null,
          documento: null,
          tipo: 'proprietario',
          bloco: 'a',
          apartamento: '1',
          id_condominio: 7,
          id_superlogica_con: null,
        })),
        update,
      },
      condominios: {
        findUnique: jest.fn(async () => ({ id: 7, id_superlogica_cond: 43, superlogica_escrita: 1 })),
      },
      apartamentos: { findFirst: jest.fn(async () => ({ id: 55, id_superlogica_uni: 1901 })) },
    };

    let chamada = 0;
    const superlogica = {
      listarUnidades: jest.fn(async () => {
        chamada++;
        const contatos = chamada === 1 ? [{ id_contato_con: '4589' }] : (opcoes.contatosDepois ?? []);
        return [{ id_unidade_uni: '1901', contatos }];
      }),
    };

    const put = jest.fn(async () => opcoes.resposta ?? [{ status: '200', msg: ' 01 a - Sucesso' }]);
    const service = new SuperlogicaWriteService(prisma, { putEscritaRestrita: put } as any, superlogica as any);
    return { service, update };
  }

  it('confirma pelo id que não existia antes, mesmo sem CPF nem e-mail', async () => {
    const { service, update } = montar({
      contatosDepois: [{ id_contato_con: '4589' }, { id_contato_con: '4595' }],
    });

    const r = await service.enviarMorador(10);

    expect(r.enviado).toBe(true);
    expect(r.idContatoSuperlogica).toBe(4595);
    expect(update).toHaveBeenCalledWith({ where: { id: 10 }, data: { id_superlogica_con: 4595 } });
  });

  it('NÃO diz enviado quando o ERP responde OK e nada aparece', async () => {
    // Exatamente o caso de produção.
    const { service, update } = montar({ contatosDepois: [{ id_contato_con: '4589' }] });

    const r = await service.enviarMorador(10);

    expect(r.enviado).toBe(false);
    expect(r.motivo).toContain('nenhum contato novo');
    // Não pode marcar como enviado: o morador precisa continuar pendente.
    expect(update).not.toHaveBeenCalled();
  });

  it('trata recusa que vem com HTTP 200 no corpo', async () => {
    // A Superlógica responde 200 mesmo recusando; o veredito está em `status`.
    const { service, update } = montar({
      resposta: [{ status: '400', msg: 'Data de entrada inválida' }],
    });

    const r = await service.enviarMorador(10);

    expect(r.enviado).toBe(false);
    expect(r.motivo).toContain('Data de entrada inválida');
    expect(update).not.toHaveBeenCalled();
  });
});

/**
 * "ERP" em memória para os testes de resolução de apartamento, corrida e lote.
 *
 * O PUT aqui SUBSTITUI a lista de contatos da unidade pela que veio no payload
 * — a hipótese pessimista da §7.1, a que o reenvio de todos os contatos existe
 * para proteger. Com ela, um contato que o payload esquecer de reenviar SOME,
 * que é justamente o estrago que a corrida causa no ERP real.
 *
 * Nenhum teste toca a rede.
 */
function cenarioErp(opcoes: {
  moradores: any[];
  /** Vínculos de `Apartamentos_Users`, por `id_user`. */
  vinculos?: Record<number, { id: number; id_superlogica_uni: number | null }[]>;
  /** O que o casamento por texto acharia (o caminho antigo). */
  aptoPorTexto?: { id: number; id_superlogica_uni: number | null } | null;
  unidades?: { id_unidade_uni: string; contatos: any[] }[];
  /** ERP que cria o contato mas não devolve CPF/e-mail na releitura. */
  erpNaoEcoaDados?: boolean;
}) {
  const estado = opcoes.unidades ?? [{ id_unidade_uni: '1901', contatos: [] }];
  const travas = new Map<number, Promise<void>>();
  /** Unidades cujo próximo PUT aplica a escrita e MESMO ASSIM lança. */
  const falhas = new Set<number>();
  let proximoId = 900;

  // Cópia a cada leitura: no ERP de verdade cada listagem traz objetos novos, e
  // o teste não pode passar por causa de alias com o estado interno.
  const clonar = () => estado.map((u) => ({ ...u, contatos: u.contatos.map((c: any) => ({ ...c })) }));

  const listarUnidades = jest.fn(async () => clonar());

  const put = jest.fn(async (_rota: string, payload: any) => {
    const idUnidade = Number(payload['ID_UNIDADE_UNI']);
    // Latência do ERP: é nesta janela que dois envios se atropelavam.
    await (travas.get(idUnidade) ?? new Promise<void>((r) => setImmediate(r)));

    const unidade = estado.find((u) => Number(u.id_unidade_uni) === idUnidade);
    if (!unidade) return [{ status: '400', msg: 'unidade inexistente' }];

    const reenviados = Object.keys(payload)
      .filter((k) => k.endsWith('[ID_CONTATO_CON]'))
      .map((k) => String(payload[k]));
    const doNovo = (campo: string) =>
      String(Object.entries(payload).find(([k]) => k.endsWith(`[${campo}]`))?.[1] ?? '');

    unidade.contatos = [
      ...unidade.contatos.filter((c: any) => reenviados.includes(String(c.id_contato_con))),
      {
        id_contato_con: String(proximoId++),
        st_nome_con: doNovo('ST_NOME_CON'),
        // O ERP guarda o que recebeu: é assim que o contato é reconhecível
        // depois pelo casamento por CPF/e-mail.
        st_cpf_con: opcoes.erpNaoEcoaDados ? '' : doNovo('ST_CPF_CON'),
        st_email_con: opcoes.erpNaoEcoaDados ? '' : doNovo('ST_EMAIL_CON'),
      },
    ];

    // A escrita foi aplicada e a resposta se perdeu — timeout ou 5xx depois do
    // commit. Daqui de fora os dois casos são indistinguíveis.
    if (falhas.delete(idUnidade)) throw new Error('timeout na resposta do ERP');

    return [{ status: '200', msg: '01 a - Sucesso' }];
  });

  const update = jest.fn(async () => ({}));
  const findFirstApto = jest.fn(async () => opcoes.aptoPorTexto ?? null);
  const findManyVinculos = jest.fn(async ({ where }: any) =>
    (opcoes.vinculos?.[where.id_user] ?? []).map((apartamento) => ({ apartamento })),
  );

  const prisma: any = {
    moradores: {
      findUnique: jest.fn(async ({ where }: any) => opcoes.moradores.find((m) => m.id === where.id) ?? null),
      findMany: jest.fn(async () =>
        opcoes.moradores.filter((m) => m.id_superlogica_con == null).map((m) => ({ id: m.id, nome: m.nome })),
      ),
      update,
    },
    condominios: {
      findUnique: jest.fn(async () => ({ id: 7, id_superlogica_cond: 43, superlogica_escrita: 1 })),
    },
    apartamentos: { findFirst: findFirstApto },
    apartamentos_Users: { findMany: findManyVinculos },
  };

  const service = new SuperlogicaWriteService(
    prisma,
    { putEscritaRestrita: put } as any,
    { listarUnidades } as any,
  );

  /** Segura o PUT daquela unidade até quem chamou soltar. */
  const travar = (idUnidade: number) => {
    let liberar!: () => void;
    travas.set(idUnidade, new Promise<void>((r) => (liberar = r)));
    return () => {
      travas.delete(idUnidade);
      liberar();
    };
  };

  const idsDoPayload = (payload: any) =>
    Object.keys(payload)
      .filter((k) => k.endsWith('[ID_CONTATO_CON]'))
      .map((k) => String(payload[k]));

  return { service, put, listarUnidades, update, findFirstApto, estado, travar, falhas, idsDoPayload };
}

const moradorFake = (id: number, extra: any = {}) => ({
  id,
  nome: `Morador ${id}`,
  email: `morador${id}@x.com`,
  telefone: null,
  documento: null,
  tipo: 'proprietario',
  bloco: 'a',
  apartamento: '1',
  id_user: 1000 + id,
  id_condominio: 7,
  id_superlogica_con: null,
  ...extra,
});

/**
 * Em qual unidade do ERP real o contato vai parar.
 *
 * Errar aqui é gravar o morador no apartamento de outra pessoa — o motivo de o
 * vínculo por ID vir antes do casamento por texto.
 */
describe('SuperlogicaWriteService — resolução do apartamento', () => {
  it('recusa morador sem apartamento identificável em vez de casar NULL/NULL', async () => {
    // `{ bloco: null, apto: null }` casa com QUALQUER linha de bloco/apto nulos
    // do condomínio — o MySQL trata NULL como distinto, então o unique não
    // impede duplicatas. O morador nasceria numa unidade qualquer do ERP.
    const { service, put, findFirstApto } = cenarioErp({
      moradores: [moradorFake(10, { bloco: null, apartamento: '' })],
      aptoPorTexto: { id: 55, id_superlogica_uni: 1901 },
    });

    const r = await service.enviarMorador(10);

    expect(r.enviado).toBe(false);
    expect(r.motivo).toBe('morador sem apartamento identificado');
    expect(findFirstApto).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('usa o apartamento do vínculo por ID, não o casamento por texto', async () => {
    // O texto ("a"/"1") apontaria para a unidade 1901; o vínculo diz 1902.
    // Renomear apartamento não pode desviar o morador de unidade.
    const { service, put, findFirstApto } = cenarioErp({
      moradores: [moradorFake(10)],
      vinculos: { 1010: [{ id: 56, id_superlogica_uni: 1902 }] },
      aptoPorTexto: { id: 55, id_superlogica_uni: 1901 },
      unidades: [
        { id_unidade_uni: '1901', contatos: [] },
        { id_unidade_uni: '1902', contatos: [] },
      ],
    });

    const r = await service.enviarMorador(10);

    expect(r.enviado).toBe(true);
    expect(findFirstApto).not.toHaveBeenCalled();
    expect(put.mock.calls[0][1]['ID_UNIDADE_UNI']).toBe(1902);
  });

  it('recusa quando o vínculo é ambíguo entre apartamentos elegíveis', async () => {
    // Adivinhar entre dois é como o morador entra na unidade errada. Aqui nem o
    // desempate por bloco/apto ajuda: a linha do morador diz "a"/"1" e nenhum
    // dos dois apartamentos vinculados é esse — o cadastro está inconsistente,
    // e é ele que precisa ser corrigido.
    const { service, put } = cenarioErp({
      moradores: [moradorFake(10)],
      vinculos: {
        1010: [
          { id: 55, id_superlogica_uni: 1901, bloco: 'b', apto: '2' },
          { id: 56, id_superlogica_uni: 1902, bloco: 'c', apto: '3' },
        ],
      },
    });

    const r = await service.enviarMorador(10);

    expect(r.enviado).toBe(false);
    // O motivo tem que apontar para onde o operador conserta. Mandar "envie
    // pelo painel" era um beco sem saída: o painel roda este mesmo código.
    expect(r.motivo).toContain('corrija o vínculo no cadastro do morador');
    expect(put).not.toHaveBeenCalled();
  });

  it('proprietário com duas unidades no mesmo condomínio sobe nas duas', async () => {
    // `moradores.service.ts` cria UMA linha de `Moradores` por vínculo, todas
    // com o mesmo `id_user`. Sem desempatar por bloco/apto, as duas linhas veem
    // dois candidatos e as duas são recusadas para sempre — o proprietário com
    // dois aptos, que é caso comum, nunca mais sobe ao ERP.
    const vinculos = [
      { id: 55, id_superlogica_uni: 1901, bloco: 'a', apto: '1' },
      { id: 56, id_superlogica_uni: 1902, bloco: 'a', apto: '2' },
    ];
    const { service, put } = cenarioErp({
      moradores: [
        moradorFake(10, { id_user: 1010, bloco: 'a', apartamento: '1' }),
        moradorFake(11, { id_user: 1010, bloco: 'a', apartamento: '2' }),
      ],
      vinculos: { 1010: vinculos },
      unidades: [
        { id_unidade_uni: '1901', contatos: [] },
        { id_unidade_uni: '1902', contatos: [] },
      ],
    });

    const a = await service.enviarMorador(10);
    const b = await service.enviarMorador(11);

    expect([a.enviado, b.enviado]).toEqual([true, true]);
    expect(put.mock.calls[0][1]['ID_UNIDADE_UNI']).toBe(1901);
    expect(put.mock.calls[1][1]['ID_UNIDADE_UNI']).toBe(1902);
  });

  it('desempata pelo vínculo que tem unidade no ERP', async () => {
    // Um só é candidato de verdade: o outro não tem onde pendurar contato.
    const { service, put } = cenarioErp({
      moradores: [moradorFake(10)],
      vinculos: {
        1010: [
          { id: 55, id_superlogica_uni: null },
          { id: 56, id_superlogica_uni: 1901 },
        ],
      },
    });

    const r = await service.enviarMorador(10);

    expect(r.enviado).toBe(true);
    expect(put.mock.calls[0][1]['ID_UNIDADE_UNI']).toBe(1901);
  });

  it('cai no casamento por texto quando não há vínculo por ID', async () => {
    const { service, put, findFirstApto } = cenarioErp({
      moradores: [moradorFake(10)],
      aptoPorTexto: { id: 55, id_superlogica_uni: 1901 },
    });

    const r = await service.enviarMorador(10);

    expect(r.enviado).toBe(true);
    expect(findFirstApto).toHaveBeenCalled();
    expect(put.mock.calls[0][1]['ID_UNIDADE_UNI']).toBe(1901);
  });
});

/**
 * Dois envios simultâneos para a MESMA unidade.
 *
 * Sem serialização, os dois leem a mesma lista de contatos e o segundo PUT sai
 * sem o contato que o primeiro acabou de criar — apagando um morador real do
 * ERP, sob a hipótese que a §7.1 declara não resolvida.
 */
describe('SuperlogicaWriteService — corrida na mesma unidade', () => {
  it('o payload do segundo envio inclui o contato criado pelo primeiro', async () => {
    const { service, put, estado, idsDoPayload } = cenarioErp({
      moradores: [moradorFake(10), moradorFake(11)],
      vinculos: {
        1010: [{ id: 55, id_superlogica_uni: 1901 }],
        1011: [{ id: 55, id_superlogica_uni: 1901 }],
      },
      unidades: [{ id_unidade_uni: '1901', contatos: [{ id_contato_con: '500', st_nome_con: 'Vizinho' }] }],
    });

    const [a, b] = await Promise.all([service.enviarMorador(10), service.enviarMorador(11)]);

    expect(put).toHaveBeenCalledTimes(2);
    expect(idsDoPayload(put.mock.calls[0][1])).toEqual(['500']);
    // O segundo PUT carrega o vizinho E o contato recém-criado pelo primeiro.
    expect(idsDoPayload(put.mock.calls[1][1])).toEqual(['500', '900']);
    // E nada sumiu da unidade.
    expect(estado[0].contatos.map((c: any) => c.id_contato_con)).toEqual(['500', '900', '901']);
    expect([a.idContatoSuperlogica, b.idContatoSuperlogica]).toEqual([900, 901]);
  });

  it('envios em unidades diferentes não esperam um pelo outro', async () => {
    const { service, travar } = cenarioErp({
      moradores: [moradorFake(10), moradorFake(11)],
      vinculos: {
        1010: [{ id: 55, id_superlogica_uni: 1901 }],
        1011: [{ id: 56, id_superlogica_uni: 1902 }],
      },
      unidades: [
        { id_unidade_uni: '1901', contatos: [] },
        { id_unidade_uni: '1902', contatos: [] },
      ],
    });

    const liberar = travar(1901);
    const preso = service.enviarMorador(10);

    // Se a trava fosse global em vez de por unidade, isto nunca resolveria.
    const livre = await service.enviarMorador(11);
    expect(livre.enviado).toBe(true);

    liberar();
    expect((await preso).enviado).toBe(true);
  });
});

/**
 * O lote não pode varrer o condomínio inteiro uma vez por morador: 300
 * pendentes viravam milhares de requisições sequenciais dentro de uma única
 * requisição HTTP.
 */
describe('SuperlogicaWriteService — reenvio em lote', () => {
  function lote() {
    return cenarioErp({
      moradores: [moradorFake(10), moradorFake(11), moradorFake(12)],
      vinculos: {
        1010: [{ id: 55, id_superlogica_uni: 1901 }],
        1011: [{ id: 55, id_superlogica_uni: 1901 }],
        1012: [{ id: 56, id_superlogica_uni: 1902 }],
      },
      unidades: [
        { id_unidade_uni: '1901', contatos: [] },
        { id_unidade_uni: '1902', contatos: [] },
      ],
    });
  }

  it('faz UMA leitura de entrada para o lote inteiro', async () => {
    const { service, listarUnidades } = lote();

    const r = await service.reenviarPendentes(7);

    expect(r.enviados).toBe(3);
    // Antes: 2 leituras por morador (6). Agora: 1 de entrada + 1 confirmação
    // por envio bem-sucedido — e as confirmações continuam existindo, são elas
    // que provam que o contato nasceu.
    expect(listarUnidades).toHaveBeenCalledTimes(1 + 3);
  });

  it('recusa um segundo lote no mesmo condomínio enquanto o primeiro roda', async () => {
    // O mutex por unidade serializa os PUTs, mas cada lote tem seu próprio
    // array de unidades: a lista do segundo não enxerga o contato que o
    // primeiro acabou de criar, e o payload sai duplicando contato no ERP real.
    // Como o reenvio é síncrono e demora, o operador reaperta o botão — este é
    // o caminho comum, não o raro.
    const { service, travar, put } = lote();

    const liberar = travar(1901);
    const primeiro = service.reenviarPendentes(7);
    // Dá tempo de o primeiro lote chegar ao PUT preso antes do segundo entrar.
    await new Promise((r) => setImmediate(r));

    const segundo = await service.reenviarPendentes(7);

    expect(segundo.emAndamento).toBe(true);
    expect(segundo.total).toBe(0);
    expect(segundo.resultados).toEqual([]);
    expect(segundo.motivo).toContain('reenvio em andamento');

    liberar();
    expect((await primeiro).enviados).toBe(3);
    // Só os três PUTs do primeiro lote — nenhum contato duplicado nasceu.
    expect(put).toHaveBeenCalledTimes(3);
  });

  it('libera o condomínio depois que o lote termina', async () => {
    // A guarda não pode virar trava permanente: um lote que terminou (ou que
    // estourou) tem de deixar o próximo passar.
    const { service } = lote();

    await service.reenviarPendentes(7);
    const segundo = await service.reenviarPendentes(7);

    expect(segundo.emAndamento).toBeUndefined();
  });

  it('o segundo morador da mesma unidade não apaga o contato do primeiro', async () => {
    // Reaproveitar a lista sem atualizá-la reintroduziria a corrida dentro do
    // próprio laço.
    const { service, estado, put, idsDoPayload } = lote();

    await service.reenviarPendentes(7);

    expect(idsDoPayload(put.mock.calls[1][1])).toEqual(['900']);
    expect(estado[0].contatos.map((c: any) => c.id_contato_con)).toEqual(['900', '901']);
  });

  it('PUT que lança não deixa a lista do lote obsoleta', async () => {
    // Timeout na resposta depois de o ERP aplicar a escrita: daqui de fora não
    // dá para saber se o contato nasceu. Seguir o lote com a entrada antiga
    // desta unidade faria o próximo morador montar o payload sem ele — e apagá-
    // lo do ERP. A entrada é descartada, e a próxima escrita relê.
    const { service, estado, put, listarUnidades, falhas, idsDoPayload } = lote();
    falhas.add(1901);

    const r = await service.reenviarPendentes(7);

    expect(r.resultados[0]).toMatchObject({ id: 10, enviado: false });
    expect(r.resultados[1]).toMatchObject({ id: 11, enviado: true });
    // O segundo morador da unidade 1901 releu e mandou o contato órfão junto.
    expect(idsDoPayload(put.mock.calls[1][1])).toEqual(['900']);
    expect(estado[0].contatos.map((c: any) => c.id_contato_con)).toEqual(['900', '901']);
    // 1 leitura de entrada + 1 releitura (entrada descartada) + 2 confirmações
    // dos dois envios que responderam.
    expect(listarUnidades).toHaveBeenCalledTimes(4);
  });

  it('relê o ERP quando a unidade não está na lista pré-carregada', async () => {
    // Unidade criada no ERP depois da leitura de entrada do lote. Recusar sem
    // consultar seria dizer "não existe" sobre algo que existe — o envio avulso
    // teria encontrado.
    const { service, put, listarUnidades } = cenarioErp({
      moradores: [moradorFake(10)],
      vinculos: { 1010: [{ id: 55, id_superlogica_uni: 1901 }] },
    });

    const r = await service.enviarMorador(10, []);

    expect(r.enviado).toBe(true);
    expect(put).toHaveBeenCalledTimes(1);
    expect(listarUnidades).toHaveBeenCalledTimes(2); // releitura + confirmação
  });

  it('recusa morador sem CPF nem e-mail ANTES de escrever — nenhum órfão nasce', async () => {
    // Sem CPF nem e-mail não há como confirmar qual contato é dele, então ele
    // continuaria pendente e cada passada do reenvio criaria outro contato
    // órfão na unidade, sem teto. Recusar antes do PUT não perde nada: o envio
    // avulso, que lê dentro do lock, dá conta desse morador.
    const { service, put, update, estado } = cenarioErp({
      moradores: [moradorFake(10, { email: null, documento: null })],
      vinculos: { 1010: [{ id: 55, id_superlogica_uni: 1901 }] },
    });

    const r = await service.reenviarPendentes(7);

    expect(put).not.toHaveBeenCalled();
    expect(estado[0].contatos).toEqual([]);
    expect(update).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
    expect(r.resultados[0].motivo).toContain('sem CPF nem e-mail');
  });

  it('não vincula contato que não dá para reconhecer como sendo do morador', async () => {
    // Rede de segurança do caminho de lote: a lista de entrada é mais velha que
    // o lock, então um contato criado pelo app nessa janela também aparece como
    // "id que não existia antes". Vincular ele cruzaria o `id_superlogica_con`
    // com a pessoa errada — e como esse campo é a trava de idempotência,
    // ninguém tentaria de novo.
    //
    // Aqui o morador TEM e-mail (senão seria recusado antes do PUT), mas o ERP
    // não devolve os dados do contato criado, então nada casa com ele.
    const { service, update, put } = cenarioErp({
      moradores: [moradorFake(10)],
      vinculos: { 1010: [{ id: 55, id_superlogica_uni: 1901 }] },
      unidades: [{ id_unidade_uni: '1901', contatos: [] }],
      erpNaoEcoaDados: true,
    });

    const r = await service.enviarMorador(10, [{ id_unidade_uni: '1901', contatos: [] } as any]);

    expect(put).toHaveBeenCalledTimes(1);
    expect(r.enviado).toBe(false);
    expect(r.motivo).toContain('não dá para confirmar qual contato');
    // Fica pendente e é tentado de novo — e, tendo e-mail, a próxima tentativa
    // reconhece o contato em vez de criar outro.
    expect(update).not.toHaveBeenCalled();
  });
});

describe('SuperlogicaClient — a escrita não abre a porta para o resto', () => {
  let client: SuperlogicaClient;

  beforeEach(() => {
    process.env.SUPERLOGICA_APP_TOKEN = 'x';
    process.env.SUPERLOGICA_ACCESS_TOKEN = 'y';
    client = new SuperlogicaClient();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it.each(['cobranca/liquidar', 'cobranca/excluir', 'unidades/delete', 'condominios'])(
    'recusa escrever em %s',
    async (rota) => {
      await expect(client.putEscritaRestrita(rota, {})).rejects.toBeInstanceOf(SuperlogicaRotaBloqueadaError);
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it('recusa LER por uma rota de escrita', async () => {
    // As duas allowlists são separadas: estar liberada para escrita não libera
    // a rota para leitura, nem o contrário.
    await expect(client.get('unidades/post')).rejects.toBeInstanceOf(SuperlogicaRotaBloqueadaError);
  });
});

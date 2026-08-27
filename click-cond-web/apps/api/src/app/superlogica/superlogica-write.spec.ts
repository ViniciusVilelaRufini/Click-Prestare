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

  it('marca proprietário e inquilino com rótulos diferentes', () => {
    const prop = SuperlogicaWriteService.montarPayload(43, 1901, [], { nome: 'X', tipo: 'proprietario' });
    const inq = SuperlogicaWriteService.montarPayload(43, 1901, [], { nome: 'Y', tipo: 'inquilino' });

    expect(prop['contatos[0][ID_LABEL_TRES]']).toBe(1); // proprietário residente
    expect(inq['contatos[0][ID_LABEL_TRES]']).toBe(7); // residente
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

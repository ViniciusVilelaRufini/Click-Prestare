import { ConflictException, NotFoundException } from '@nestjs/common';
import { CrmSuperlogicaService } from './crm-superlogica.service';

/**
 * Ativação comercial da integração Superlógica.
 *
 * O risco desta tela é vincular errado: apontar dois condomínios do Clique para
 * o mesmo condomínio do ERP faz os dois puxarem as mesmas cobranças, e um
 * prédio passa a ver os boletos do outro.
 */
describe('CrmSuperlogicaService — vínculo', () => {
  const CASA_PIENZA = { id_condominio_cond: '24', st_nome_cond: 'CASA PIENZA', st_fantasia_cond: 'CASA PIENZA' };
  const DAMHA = { id_condominio_cond: '31', st_nome_cond: 'DAMHA', st_fantasia_cond: 'DAMHA' };

  function montar(opcoes: {
    condominios?: any[];
    vinculados?: any[];
    unidades?: any[];
    erroUpdate?: any;
  } = {}) {
    const update = jest.fn(async () => {
      if (opcoes.erroUpdate) throw opcoes.erroUpdate;
      return {};
    });
    const updateManyApartamentos = jest.fn(async () => ({ count: 0 }));
    const registrar = jest.fn(async () => undefined);

    const prisma: any = {
      condominios: {
        findUnique: jest.fn(async ({ where }: any) =>
          (opcoes.condominios ?? []).find((c) => c.id === where.id) ?? null,
        ),
        findMany: jest.fn(async () => opcoes.vinculados ?? []),
        update,
      },
      apartamentos: { count: jest.fn(async () => 0), updateMany: updateManyApartamentos },
    };
    // $transaction recebe um callback e o executa com o próprio prisma mockado.
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const superlogica = {
      listarCondominios: jest.fn(async () => [CASA_PIENZA, DAMHA]),
      listarUnidades: jest.fn(async () => opcoes.unidades ?? []),
    };

    const client = { estaConfigurado: () => true };
    const auditoria = { registrar };

    const sync = { importarUnidades: jest.fn(), sincronizarCondominio: jest.fn() };
    const criarMorador = jest.fn(async () => ({ id: 1 }));

    const service = new CrmSuperlogicaService(
      prisma as any,
      superlogica as any,
      client as any,
      auditoria as any,
      sync as any,
      { create: criarMorador } as any,
    );

    return { service, prisma, superlogica, update, registrar, updateManyApartamentos, sync, criarMorador };
  }

  it('vincula e registra em auditoria', async () => {
    const { service, update, registrar } = montar({
      condominios: [{ id: 7, nome: 'Meu Prédio', id_superlogica_cond: null }],
    });

    const r = await service.vincular(7, 24, 'Erika');

    expect(update).toHaveBeenCalledWith({ where: { id: 7 }, data: { id_superlogica_cond: 24 } });
    expect(r.nomeSuperlogica).toBe('CASA PIENZA');
    expect(registrar).toHaveBeenCalled();
  });

  it('recusa id que não existe na Superlógica', async () => {
    // Aceitar um número qualquer criaria um vínculo que só falharia depois, na
    // primeira sincronização.
    const { service, update } = montar({
      condominios: [{ id: 7, nome: 'Meu Prédio', id_superlogica_cond: null }],
    });

    await expect(service.vincular(7, 999, 'Erika')).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('recusa vincular um condomínio do ERP já usado por outro cliente', async () => {
    // É o caso que faria um prédio ver os boletos do outro.
    const { service, update } = montar({
      condominios: [{ id: 7, nome: 'Meu Prédio', id_superlogica_cond: null }],
      vinculados: [{ id: 3, nome: 'Outro Prédio', id_superlogica_cond: 24 }],
    });

    await expect(service.vincular(7, 24, 'Erika')).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('permite regravar o mesmo vínculo no mesmo condomínio', async () => {
    const { service, update } = montar({
      condominios: [{ id: 3, nome: 'Outro Prédio', id_superlogica_cond: 24 }],
      vinculados: [{ id: 3, nome: 'Outro Prédio', id_superlogica_cond: 24 }],
    });

    await expect(service.vincular(3, 24, 'Erika')).resolves.toMatchObject({ success: true });
    expect(update).toHaveBeenCalled();
  });

  it('recusa condomínio do Clique inexistente', async () => {
    const { service } = montar({ condominios: [] });

    await expect(service.vincular(404, 24, 'Erika')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('limpa os vínculos de unidade ao trocar de condomínio no ERP', async () => {
    // id_unidade_uni 726 no condomínio 24 não é a mesma unidade que o 726 no
    // 31. Manter os antigos casaria cobrança com o apartamento errado.
    const { service, updateManyApartamentos } = montar({
      condominios: [{ id: 7, nome: 'Meu Prédio', id_superlogica_cond: 24 }],
    });

    await service.vincular(7, 31, 'Erika');

    expect(updateManyApartamentos).toHaveBeenCalledWith({
      where: { id_condominio: 7 },
      data: { id_superlogica_uni: null },
    });
  });

  it('preserva os vínculos de unidade ao regravar o mesmo id', async () => {
    const { service, updateManyApartamentos } = montar({
      condominios: [{ id: 3, nome: 'Outro Prédio', id_superlogica_cond: 24 }],
      vinculados: [{ id: 3, nome: 'Outro Prédio', id_superlogica_cond: 24 }],
    });

    await service.vincular(3, 24, 'Erika');

    expect(updateManyApartamentos).not.toHaveBeenCalled();
  });

  it('devolve 409 quando o índice único barra uma corrida entre operadores', async () => {
    // Sem tratar o P2002, o operador veria "Internal Server Error".
    const { service } = montar({
      condominios: [{ id: 7, nome: 'Meu Prédio', id_superlogica_cond: null }],
      erroUpdate: Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    });

    await expect(service.vincular(7, 24, 'Erika')).rejects.toBeInstanceOf(ConflictException);
  });

  it('marca na listagem quais condomínios do ERP já estão em uso', async () => {
    const { service } = montar({
      vinculados: [{ id: 3, nome: 'Outro Prédio', id_superlogica_cond: 24 }],
    });

    const lista = await service.listarDisponiveis();

    expect(lista.find((c) => c.idSuperlogica === 24)?.vinculadoA).toEqual({ id: 3, nome: 'Outro Prédio' });
    expect(lista.find((c) => c.idSuperlogica === 31)?.vinculadoA).toBeNull();
  });
});

describe('CrmSuperlogicaService — importação de moradores', () => {
  function montarImport(contatos: any[]) {
    const criarMorador = jest.fn(async () => ({ id: 1 }));
    const updateMorador = jest.fn(async () => ({}));
    const sync = {
      importarUnidades: jest.fn(async () => ({
        unidadesNoErp: 1,
        apartamentosCriados: 1,
        apartamentosVinculados: 0,
        duplicadasIgnoradas: [],
        contatosPorApartamento: [{ idApartamento: 55, contatos }],
      })),
    };

    const service = new CrmSuperlogicaService(
      { moradores: { update: updateMorador } } as any,
      {} as any,
      {} as any,
      { registrar: jest.fn() } as any,
      sync as any,
      { create: criarMorador } as any,
      {} as any,
    );

    return { service, criarMorador, updateMorador };
  }

  it('não cria morador quando a opção está desligada', async () => {
    // Trazer contato cria conta para pessoa real: só com escolha explícita.
    const { service, criarMorador } = montarImport([{ st_nome_con: 'Fulano' }]);

    const r = await service.importarUnidades(7, 'Erika');

    expect(criarMorador).not.toHaveBeenCalled();
    expect(r.moradoresCriados).toBe(0);
  });

  it('cria o morador vinculado ao apartamento, sem e-mail e sem devolver ao ERP', async () => {
    const { service, criarMorador } = montarImport([
      { st_nome_con: 'Fulano', st_email_con: 'f@x.com', st_cpf_con: '123', st_nometiporesp_tres: 'Inquilino' },
    ]);

    const r = await service.importarUnidades(7, 'Erika', true);

    expect(r.moradoresCriados).toBe(1);
    const dto = criarMorador.mock.calls[0][0] as any;
    expect(dto.nome).toBe('Fulano');
    expect(dto.tipo).toBe('inquilino');
    expect(dto.id_apartamento).toBe(55);
    // Importar não pode disparar e-mail para o morador.
    expect(dto.sendCredentials).toBe(false);
    // Nem devolver ao ERP quem veio de lá — criaria contato duplicado.
    expect(dto.skipSuperlogica).toBe(true);
  });

  it('marca o morador importado com o id do contato de origem', async () => {
    // Sem isso, "Reenviar moradores" o trataria como pendente e o devolveria ao
    // ERP. Como os contatos de lá costumam vir sem CPF nem e-mail, a checagem
    // de duplicidade não o reconheceria e criaria um contato repetido.
    const { service, updateMorador } = montarImport([
      { st_nome_con: 'Fulano', id_contato_con: '4589' },
    ]);

    await service.importarUnidades(7, 'Erika', true);

    expect(updateMorador).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { id_superlogica_con: 4589 },
    });
  });

  it('conta duplicata em vez de estourar ao reimportar', async () => {
    const { service, criarMorador } = montarImport([{ st_nome_con: 'Fulano' }]);
    criarMorador.mockRejectedValueOnce(Object.assign(new Error('já cadastrado'), { status: 400 }));

    const r = await service.importarUnidades(7, 'Erika', true);

    expect(r.moradoresJaExistiam).toBe(1);
    expect(r.moradoresCriados).toBe(0);
  });

  it('ignora contato sem nome', async () => {
    const { service, criarMorador } = montarImport([{ st_nome_con: '  ', st_email_con: 'x@x.com' }]);

    const r = await service.importarUnidades(7, 'Erika', true);

    expect(criarMorador).not.toHaveBeenCalled();
    expect(r.moradoresSemNome).toBe(1);
  });
});

describe('CrmSuperlogicaService — desvínculo', () => {
  it('desliga a integração sem apagar o que já foi sincronizado', async () => {
    // Apagar histórico financeiro do morador por causa de um clique no CRM
    // seria destrutivo demais. O prisma mockado não expõe financeiro.delete —
    // se o service tentasse apagar, o teste estouraria.
    const update = jest.fn(async () => ({}));
    const updateManyApartamentos = jest.fn(async () => ({ count: 0 }));
    const prisma: any = {
      condominios: {
        findUnique: jest.fn(async () => ({ id: 7, nome: 'Meu Prédio', id_superlogica_cond: 24 })),
        update,
      },
      apartamentos: { updateMany: updateManyApartamentos },
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const service = new CrmSuperlogicaService(
      prisma as any,
      {} as any,
      {} as any,
      { registrar: jest.fn() } as any,
      {} as any,
      {} as any,
    );

    await expect(service.desvincular(7, 'Erika')).resolves.toMatchObject({ success: true });
    expect(update).toHaveBeenCalledWith({ where: { id: 7 }, data: { id_superlogica_cond: null } });
  });

  it('limpa os vínculos de unidade ao desativar', async () => {
    // Fecha o caminho: desvincular do ERP 24 e vincular ao 31 não passaria pela
    // checagem de troca em vincular(), porque o vínculo anterior já seria null.
    const updateManyApartamentos = jest.fn(async () => ({ count: 12 }));
    const prisma: any = {
      condominios: {
        findUnique: jest.fn(async () => ({ id: 7, nome: 'Meu Prédio', id_superlogica_cond: 24 })),
        update: jest.fn(async () => ({})),
      },
      apartamentos: { updateMany: updateManyApartamentos },
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const service = new CrmSuperlogicaService(prisma, {} as any, {} as any, { registrar: jest.fn() } as any, {} as any, {} as any);

    await service.desvincular(7, 'Erika');

    expect(updateManyApartamentos).toHaveBeenCalledWith({
      where: { id_condominio: 7 },
      data: { id_superlogica_uni: null },
    });
  });
});

describe('CrmSuperlogicaService — prévia de unidades', () => {
  function montarPreview(id_superlogica_cond: number | null) {
    const listarUnidades = jest.fn(async () => [
      { id_unidade_uni: '726', st_bloco_uni: '01', st_unidade_uni: '000101', contatos: [{}] },
    ]);

    const service = new CrmSuperlogicaService(
      {
        condominios: { findUnique: jest.fn(async () => ({ id: 7, nome: 'Meu Prédio', id_superlogica_cond })) },
        apartamentos: { count: jest.fn(async () => 4) },
      } as any,
      { listarUnidades } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, listarUnidades };
  }

  it('recusa prévia de condomínio sem vínculo', async () => {
    const { service } = montarPreview(null);

    await expect(service.previewUnidades(7)).rejects.toBeInstanceOf(ConflictException);
  });

  it('consulta o ERP com o id vindo do banco, não do cliente', async () => {
    // Aceitar idSuperlogica da requisição deixaria pedir as unidades de
    // qualquer condomínio da carteira.
    const { service, listarUnidades } = montarPreview(24);

    await service.previewUnidades(7);

    expect(listarUnidades).toHaveBeenCalledWith(24);
  });

  it('mostra o que existe dos dois lados antes de importar', async () => {
    const { service } = montarPreview(24);

    const r = await service.previewUnidades(7);

    expect(r.totalNoErp).toBe(1);
    expect(r.apartamentosNoClique).toBe(4);
  });
});

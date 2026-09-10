import { ConflictException } from '@nestjs/common';
import { SuperlogicaSyncService } from './superlogica-sync.service';
import { SuperlogicaService } from './superlogica.service';
import { SuperlogicaClient } from './superlogica.client';

/**
 * Importação de unidades e sincronização de cobranças.
 *
 * É aqui que uma cobrança do ERP vira lançamento na tela do morador — e onde
 * um vínculo errado faria o boleto de um apartamento aparecer no de outro.
 * Nenhum teste toca a rede: o SuperlogicaService é mockado.
 */
describe('SuperlogicaSyncService — normalização de unidade', () => {
  it('tira zeros à esquerda da identificação numérica', () => {
    // O ERP manda "000408". Guardar assim deixaria "Apto 000408" no app, e o
    // regex \bApto 408\b do Financeiro não acharia o lançamento.
    expect(SuperlogicaSyncService.normalizarUnidade('000408')).toBe('408');
    expect(SuperlogicaSyncService.normalizarUnidade('01')).toBe('1');
  });

  it('preserva identificação não numérica', () => {
    // "0A1" não é número; tirar o zero mudaria o nome da unidade.
    expect(SuperlogicaSyncService.normalizarUnidade('0A1')).toBe('0A1');
    expect(SuperlogicaSyncService.normalizarUnidade('Casa 3')).toBe('Casa 3');
  });

  it('trata vazio e só-zeros', () => {
    expect(SuperlogicaSyncService.normalizarUnidade('')).toBe('');
    expect(SuperlogicaSyncService.normalizarUnidade('0000')).toBe('0');
  });

  it('cobre o formato real do condomínio de teste (bloco alfabético)', () => {
    // Lido da licença em 27/08/2026, condomínio "Teste Prestare Api" (id 43):
    // bloco "a" minúsculo e unidades "01".."05". Diferente da CASA PIENZA, que
    // usa bloco numérico "01" — as duas formas precisam sobreviver.
    expect(SuperlogicaSyncService.normalizarUnidade('a')).toBe('a');
    expect(SuperlogicaSyncService.normalizarUnidade('01')).toBe('1');
    expect(SuperlogicaSyncService.normalizarUnidade('05')).toBe('5');
  });
});

describe('SuperlogicaSyncService — importação de unidades', () => {
  function montar(unidades: any[], existentes: any[] = [], id_superlogica_cond: number | null = 24) {
    const create = jest.fn(async () => ({}));
    const update = jest.fn(async () => ({}));

    const prisma: any = {
      condominios: {
        findUnique: jest.fn(async () => ({ id: 7, nome: 'Meu Prédio', id_superlogica_cond })),
      },
      apartamentos: {
        findFirst: jest.fn(async ({ where }: any) =>
          existentes.find((a) => a.bloco === where.bloco && a.apto === where.apto) ?? null,
        ),
        create,
        update,
      },
    };

    const superlogica = { listarUnidades: jest.fn(async () => unidades) };
    const service = new SuperlogicaSyncService(prisma, superlogica as any);
    return { service, create, update };
  }

  const unidade = (id: string, bloco: string, uni: string, contatos?: any[]) => ({
    id_unidade_uni: id,
    st_bloco_uni: bloco,
    st_unidade_uni: uni,
    contatos,
  });

  it('cria apartamento já com o vínculo de unidade', async () => {
    const { service, create } = montar([unidade('726', '01', '000101')]);

    const r = await service.importarUnidades(7);

    expect(create).toHaveBeenCalledWith({
      data: { id_condominio: 7, bloco: '1', apto: '101', id_superlogica_uni: 726 },
    });
    expect(r.apartamentosCriados).toBe(1);
  });

  it('vincula apartamento que já existia sem duplicar', async () => {
    const { service, create, update } = montar(
      [unidade('726', '01', '000101')],
      [{ id: 55, bloco: '1', apto: '101', id_superlogica_uni: null }],
    );

    const r = await service.importarUnidades(7);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: 55 }, data: { id_superlogica_uni: 726 } });
    expect(r.apartamentosVinculados).toBe(1);
  });

  it('é idempotente: reexecutar não mexe em nada', async () => {
    const { service, create, update } = montar(
      [unidade('726', '01', '000101')],
      [{ id: 55, bloco: '1', apto: '101', id_superlogica_uni: 726 }],
    );

    const r = await service.importarUnidades(7);

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(r.apartamentosCriados).toBe(0);
  });

  it('ignora a unidade fantasma do condomínio', async () => {
    const { service, create } = montar([unidade('999', '', '0000')]);

    await service.importarUnidades(7);

    expect(create).not.toHaveBeenCalled();
  });

  it('não importa duas unidades que colidem depois de normalizar', async () => {
    // "000101" e "101" viram a mesma identificação. Importar as duas faria uma
    // sobrescrever o vínculo da outra, e as cobranças de uma cairiam na outra.
    const { service, create } = montar([
      unidade('726', '01', '000101'),
      unidade('900', '01', '101'),
    ]);

    const r = await service.importarUnidades(7);

    expect(create).toHaveBeenCalledTimes(1);
    expect(r.duplicadasIgnoradas).toEqual(['1 101']);
  });

  it('recusa importar em condomínio sem vínculo', async () => {
    const { service } = montar([], [], null);

    await expect(service.importarUnidades(7)).rejects.toBeInstanceOf(ConflictException);
  });

  it('devolve os contatos por apartamento em vez de criar morador aqui', async () => {
    // Criar morador exige o cadastro oficial (MoradoresService); depender dele
    // aqui fecharia um ciclo entre SuperlogicaModule e MoradoresModule. Quem
    // orquestra é o CRM — ver crm-superlogica.spec.ts.
    const { service } = montar([
      unidade('1901', 'a', '01', [{ st_nome_con: 'Fulano', st_email_con: 'f@x.com' }]),
    ]);

    const r = await service.importarUnidades(7);

    expect(r.contatosPorApartamento).toHaveLength(1);
    expect(r.contatosPorApartamento[0].contatos[0].st_nome_con).toBe('Fulano');
  });

  it('importa o condomínio de teste real como 5 apartamentos do bloco "a"', async () => {
    // Payload real do "Teste Prestare Api" (id 43), lido em 27/08/2026.
    const reais = [
      unidade('1901', 'a', '01'),
      unidade('1902', 'a', '02'),
      unidade('1903', 'a', '03'),
      unidade('1904', 'a', '04'),
      unidade('1905', 'a', '05'),
    ];
    const { service, create } = montar(reais);

    const r = await service.importarUnidades(7);

    expect(r.apartamentosCriados).toBe(5);
    expect(r.duplicadasIgnoradas).toEqual([]);
    expect(create.mock.calls.map((c: any[]) => c[0].data.apto)).toEqual(['1', '2', '3', '4', '5']);
    expect(create.mock.calls.every((c: any[]) => c[0].data.bloco === 'a')).toBe(true);
  });
});

describe('SuperlogicaSyncService — sincronização de cobranças', () => {
  const cobranca = (id: string, idUnidade: string) => ({
    id_recebimento_recb: id,
    id_condominio_cond: '24',
    id_unidade_uni: idUnidade,
    st_documento_recb: '001/00499387345',
    dt_vencimento_recb: '08/10/2026 00:00:00',
    dt_liquidacao_recb: '',
    vl_total_recb: '350.00',
    fl_status_recb: '0',
    st_pixqrcode_recb: '00020101021226990014br.gov.bcb.pix...',
    link_segundavia: 'https://prestare.superlogica.net/x',
  });

  function montar(cobrancas: any[], apartamentos: any[], jaGravados: any[] = []) {
    const upsert = jest.fn(async () => ({}));
    const prisma: any = {
      condominios: {
        findUnique: jest.fn(async () => ({ id: 7, nome: 'Meu Prédio', id_superlogica_cond: 24 })),
      },
      apartamentos: { findMany: jest.fn(async () => apartamentos) },
      financeiro: { upsert, findMany: jest.fn(async () => jaGravados) },
    };

    const real = new SuperlogicaService(new SuperlogicaClient());
    const superlogica = {
      listarCobrancas: jest.fn(async () => cobrancas),
      mapearCobranca: real.mapearCobranca.bind(real),
    };

    const service = new SuperlogicaSyncService(prisma, superlogica as any);
    return { service, upsert, superlogica };
  }

  it('grava a cobrança no apartamento vinculado', async () => {
    const { service, upsert } = montar(
      [cobranca('91515', '837')],
      [{ id_superlogica_uni: 837, apto: '408', bloco: '4' }],
    );

    const r = await service.sincronizarCondominio(7);

    expect(r.lancamentosGravados).toBe(1);
    const arg = upsert.mock.calls[0][0] as any;
    expect(arg.create.nome).toBe('Apto 408 Bloco 4 - Ref. 08/2026');
    expect(arg.create.pix_copia_cola).toContain('br.gov.bcb.pix');
  });

  it('deduplica por (origem, condomínio, id externo)', async () => {
    const { service, upsert } = montar(
      [cobranca('91515', '837')],
      [{ id_superlogica_uni: 837, apto: '408', bloco: '4' }],
    );

    await service.sincronizarCondominio(7);

    const arg = upsert.mock.calls[0][0] as any;
    expect(arg.where.origem_id_condominio_id_externo).toEqual({
      origem: 'superlogica',
      id_condominio: 7,
      id_externo: '91515',
    });
  });

  it('não inventa vínculo quando a unidade não foi importada', async () => {
    // Casar "na marra" é exatamente como cobrança aparece para o morador errado.
    const { service, upsert } = montar([cobranca('91515', '999')], [{ id_superlogica_uni: 837, apto: '408', bloco: '4' }]);

    const r = await service.sincronizarCondominio(7);

    expect(upsert).not.toHaveBeenCalled();
    expect(r.semApartamento).toBe(1);
  });

  it('preserva comprovante e foto ao atualizar', async () => {
    // O sync só manda o que a Superlógica conhece; anexo do operador fica.
    const { service, upsert } = montar(
      [cobranca('91515', '837')],
      [{ id_superlogica_uni: 837, apto: '408', bloco: '4' }],
    );

    await service.sincronizarCondominio(7);

    const arg = upsert.mock.calls[0][0] as any;
    expect(arg.update.url_comprovante).toBeUndefined();
    expect(arg.update.photo).toBeUndefined();
  });

  it('consulta o ERP com uma janela que cobre mês anterior e seguinte', async () => {
    const { service, superlogica } = montar([], []);

    await service.sincronizarCondominio(7, new Date(2026, 7, 15)); // 15/ago/2026

    const [, inicio, fim] = superlogica.listarCobrancas.mock.calls[0] as any[];
    expect(inicio.getMonth()).toBe(6); // julho
    expect(fim.getMonth()).toBe(8); // setembro
  });

  it('varredura profunda olha doze meses para trás', async () => {
    // Sem isso, o morador que quitava um boleto de três meses atrás ficava
    // "pendente" para sempre: a janela horária nunca mais lia aquela cobrança,
    // e a baixa manual é bloqueada em origem='superlogica'.
    const { service, superlogica } = montar([], []);

    await service.sincronizarCondominio(7, new Date(2026, 7, 15), { profunda: true });

    const [, inicio, fim] = superlogica.listarCobrancas.mock.calls[0] as any[];
    expect(inicio.getFullYear()).toBe(2025);
    expect(inicio.getMonth()).toBe(7); // agosto/2025
    expect(fim.getMonth()).toBe(8); // setembro/2026, igual à passada normal
  });

  it('preserva o status de comprovante em auditoria enquanto o ERP não confirma', async () => {
    // O morador anexa comprovante → status '2'. O sync sobrescrevia com
    // 'pendente' na passada seguinte e o síndico perdia o aviso de que havia
    // comprovante para conferir.
    const { service, upsert } = montar(
      [cobranca('91515', '837')], // fl_status_recb '0' = pendente
      [{ id_superlogica_uni: 837, apto: '408', bloco: '4' }],
      [{ id_externo: '91515', status: '2', linha_digitavel: null }],
    );

    await service.sincronizarCondominio(7);

    const arg = upsert.mock.calls[0][0] as any;
    expect(arg.update.status).toBe('2');
    expect(arg.update.pago).toBe(0);
  });

  it('o pago do ERP vence sobre o comprovante em auditoria', async () => {
    // Confirmado o pagamento, a auditoria perdeu o objeto.
    const paga = { ...cobranca('91515', '837'), fl_status_recb: '3', dt_liquidacao_recb: '08/12/2026 00:00:00' };
    const { service, upsert } = montar(
      [paga],
      [{ id_superlogica_uni: 837, apto: '408', bloco: '4' }],
      [{ id_externo: '91515', status: '2', linha_digitavel: null }],
    );

    await service.sincronizarCondominio(7);

    const arg = upsert.mock.calls[0][0] as any;
    expect(arg.update.status).toBe('pago');
    expect(arg.update.pago).toBe(1);
  });

  it('reaproveita a linha digitável já gravada em vez de raspar de novo', async () => {
    // A linha digitável não vem na listagem: é raspada do HTML da 2ª via, um
    // fetch por cobrança. Repetir isso a cada passada — e apagar com null
    // quando a raspagem falha — é o que se quer evitar.
    const raspar = jest.spyOn(SuperlogicaService, 'extrairLinhaDigitavel');
    const { service, upsert } = montar(
      [cobranca('91515', '837')],
      [{ id_superlogica_uni: 837, apto: '408', bloco: '4' }],
      [{ id_externo: '91515', status: 'pendente', linha_digitavel: '34191.79001 01043.510047 91020.150008 1 99999999999999' }],
    );

    await service.sincronizarCondominio(7);

    expect(raspar).not.toHaveBeenCalled();
    const arg = upsert.mock.calls[0][0] as any;
    expect(arg.update.linha_digitavel).toContain('34191.79001');
    raspar.mockRestore();
  });

  it('não entrega cobrança quando a unidade está vinculada a dois apartamentos', async () => {
    // `new Map(...)` guardava só o último apartamento da unidade e as cobranças
    // caíam nele — boleto de um morador na tela de outro, em silêncio. O índice
    // un_apto_superlogica impediria, mas não está aplicado em produção.
    const { service, upsert } = montar(
      [cobranca('91515', '837')],
      [
        { id_superlogica_uni: 837, apto: '408', bloco: '4' },
        { id_superlogica_uni: 837, apto: '409', bloco: '4' },
      ],
    );

    const r = await service.sincronizarCondominio(7);

    expect(upsert).not.toHaveBeenCalled();
    expect(r.unidadesAmbiguas).toEqual([837]);
    expect(r.semApartamento).toBe(1);
  });

  it('não raspa linha digitável de cobrança já paga', async () => {
    // Ninguém paga um boleto duas vezes. Sem esse corte, a varredura profunda
    // dispararia um fetch para cada cobrança de doze meses, uma a uma.
    const raspar = jest
      .spyOn(SuperlogicaService, 'extrairLinhaDigitavel')
      .mockResolvedValue(null);
    const paga = { ...cobranca('91515', '837'), fl_status_recb: '3', dt_liquidacao_recb: '08/12/2026 00:00:00' };
    const { service } = montar([paga], [{ id_superlogica_uni: 837, apto: '408', bloco: '4' }]);

    await service.sincronizarCondominio(7);

    expect(raspar).not.toHaveBeenCalled();
    raspar.mockRestore();
  });
});

import { InterfoneConfigService } from './interfone-config.service';
import { CrmInterfoneController } from '../crm/crm-interfone.controller';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { criarBancoFalso } from './banco-falso.spec';
import type { FaixaAgenda } from './destino-portaria';

/*
 * Portaria autônoma (Entrega 1): o CRM liga a central, a IA no portão, o número da portaria,
 * as instruções de entrega e a agenda; o síndico vê a central só para leitura e não desliga o
 * "transferir" com a central contratada.
 */

const ATOR = { nome: 'Admin CRM', autor_id: 1, autor_tipo: 'crm_admin' as const };
const SINDICO = { nome: 'Síndica Sara', autor_id: 50, autor_tipo: 'user' as const };
const ADMIN: any = { sub: 1, nome: 'Admin', role: 'crm_admin' };

/** Agenda falsa (deleteMany/create/findMany por condomínio), independente do banco falso compartilhado. */
function agendaFalsa(inicial: Array<FaixaAgenda & { id_condominio: number }> = []) {
  let seq = 0;
  let linhas: any[] = inicial.map((f) => ({ id: ++seq, created_at: new Date(), ...f }));
  const delegado = {
    findMany: jest.fn(async (a: any = {}) => {
      const l = linhas.filter((r) => a.where?.id_condominio === undefined || r.id_condominio === a.where.id_condominio);
      return [...l].sort((x, y) => x.dia_semana - y.dia_semana || x.inicio.localeCompare(y.inicio));
    }),
    deleteMany: jest.fn(async (a: any = {}) => {
      const antes = linhas.length;
      linhas = linhas.filter((r) => r.id_condominio !== a.where?.id_condominio);
      return { count: antes - linhas.length };
    }),
    create: jest.fn(async (a: any) => {
      const r = { id: ++seq, created_at: new Date(), ...a.data };
      linhas.push(r);
      return r;
    }),
  };
  return { delegado, linhas: () => linhas };
}

function montar(cond: Record<string, any> = {}, agenda: Array<FaixaAgenda & { id_condominio: number }> = []) {
  const banco = criarBancoFalso({
    condominios: [
      {
        id: 1,
        nome: 'Residencial Teste',
        ativo: 1,
        interfone_contratado: 1,
        interfone_ativo: 1,
        interfone_toque_apto_s: 30,
        interfone_transferir: 1,
        interfone_toque_portaria_s: 45,
        central_contratada: 0,
        ia_portao_ativa: 0,
        instrucao_entregas: null,
        interfone_numero_portaria: '0',
        ...cond,
      },
      {
        id: 2,
        nome: 'Sem interfone',
        ativo: 1,
        interfone_contratado: 0,
        interfone_ativo: 0,
        interfone_toque_apto_s: 30,
        interfone_transferir: 1,
        interfone_toque_portaria_s: 45,
        central_contratada: 0,
        ia_portao_ativa: 0,
        instrucao_entregas: null,
        interfone_numero_portaria: '0',
      },
    ],
    apartamentos: [
      { id: 100, id_condominio: 1, apto: '106', bloco: 'A', interfone_ramal: '106' },
      { id: 101, id_condominio: 1, apto: '201', bloco: 'A', interfone_ramal: '201' },
      { id: 102, id_condominio: 1, apto: '9', bloco: 'B', interfone_ramal: null },
    ],
  });
  const ag = agendaFalsa(agenda);
  banco.prisma.portaria_Agenda = ag.delegado;
  const auditoria = { registrar: jest.fn(async () => undefined) };
  const svc = new InterfoneConfigService(banco.prisma, auditoria as any);
  const cond1 = () => banco.tabelas['condominios'].find((c: any) => c.id === 1);
  return { ...banco, auditoria, svc, agenda: ag, cond1 };
}

const SEG_CENTRAL: FaixaAgenda = { dia_semana: 1, inicio: '00:00', fim: '07:00', destino: 'central' };
const SEG_LOCAL: FaixaAgenda = { dia_semana: 1, inicio: '07:00', fim: '24:00', destino: 'local' };

describe('CRM: lista de clientes com a central', () => {
  it('devolve central_contratada, ia_portao_ativa, numero_portaria e instrucao_entregas', async () => {
    const m = montar({ central_contratada: 1, ia_portao_ativa: 1, interfone_numero_portaria: '9', instrucao_entregas: 'Deixe no armário.' });
    const c = new CrmInterfoneController(m.svc);
    const lista = await c.clientes();
    expect(lista).toEqual(
      expect.arrayContaining([
        {
          id: 1,
          nome: 'Residencial Teste',
          contratado: true,
          central_contratada: true,
          ia_portao_ativa: true,
          numero_portaria: '9',
          instrucao_entregas: 'Deixe no armário.',
        },
        {
          id: 2,
          nome: 'Sem interfone',
          contratado: false,
          central_contratada: false,
          ia_portao_ativa: false,
          numero_portaria: '0',
          instrucao_entregas: null,
        },
      ]),
    );
  });
});

describe('CRM: central contratada', () => {
  it('central exige interfone contratado (400 interfone_nao_contratado)', async () => {
    const m = montar();
    const c = new CrmInterfoneController(m.svc);
    await expect(c.central(2, true, ADMIN)).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ motivo: 'interfone_nao_contratado' }),
    });
    expect(m.tabelas['condominios'][1].central_contratada).toBe(0);
  });

  it('liga e desliga com auditoria; desligar não exige interfone contratado', async () => {
    const m = montar();
    const c = new CrmInterfoneController(m.svc);
    await expect(c.central(1, true, ADMIN)).resolves.toEqual({ id: 1, central_contratada: true });
    expect(m.cond1().central_contratada).toBe(1);
    expect(m.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'INTERFONE_CONFIG', id_condominio: 1, autor_tipo: 'crm_admin', usuario_nome: 'Admin' }),
    );
    await expect(c.central(2, false, ADMIN)).resolves.toEqual({ id: 2, central_contratada: false });
    await expect(c.central(1, 'sim' as any, ADMIN)).rejects.toMatchObject({ status: 400 });
    await expect(c.central(999, true, ADMIN)).rejects.toMatchObject({ status: 404 });
  });

  it('IA no portão só guarda a coluna', async () => {
    const m = montar();
    const c = new CrmInterfoneController(m.svc);
    await expect(c.ia(1, true, ADMIN)).resolves.toEqual({ id: 1, ia_portao_ativa: true });
    expect(m.cond1().ia_portao_ativa).toBe(1);
    await expect(c.ia(1, false, ADMIN)).resolves.toEqual({ id: 1, ia_portao_ativa: false });
    expect(m.cond1().ia_portao_ativa).toBe(0);
    await expect(c.ia(1, 1 as any, ADMIN)).rejects.toMatchObject({ status: 400 });
  });
});

describe('CRM: número da portaria e instruções de entrega', () => {
  it('grava número (1–8 dígitos) e instruções; vazio limpa as instruções', async () => {
    const m = montar();
    const c = new CrmInterfoneController(m.svc);
    await expect(c.portaria(1, { numero_portaria: '9000', instrucao_entregas: '  O morador vai descer. ' }, ADMIN)).resolves.toEqual({
      id: 1,
      numero_portaria: '9000',
      instrucao_entregas: 'O morador vai descer.',
    });
    expect(m.cond1()).toMatchObject({ interfone_numero_portaria: '9000', instrucao_entregas: 'O morador vai descer.' });
    await c.portaria(1, { instrucao_entregas: '' }, ADMIN);
    expect(m.cond1()).toMatchObject({ interfone_numero_portaria: '9000', instrucao_entregas: null });
  });

  it('numero_portaria igual a um ramal é recusado (400 numero_conflita_ramal)', async () => {
    const m = montar();
    const c = new CrmInterfoneController(m.svc);
    await expect(c.portaria(1, { numero_portaria: '106' }, ADMIN)).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ motivo: 'numero_conflita_ramal' }),
    });
    expect(m.cond1().interfone_numero_portaria).toBe('0');
  });

  it('número fora do formato → 400', async () => {
    const m = montar();
    const c = new CrmInterfoneController(m.svc);
    for (const n of ['', '123456789', '12a', ' ', 5 as any]) {
      await expect(c.portaria(1, { numero_portaria: n }, ADMIN)).rejects.toMatchObject({ status: 400 });
    }
    await expect(c.portaria(1, { instrucao_entregas: 'x'.repeat(2001) }, ADMIN)).rejects.toMatchObject({ status: 400 });
    await expect(c.portaria(999, { numero_portaria: '9' }, ADMIN)).rejects.toMatchObject({ status: 404 });
  });
});

describe('CRM: agenda da portaria', () => {
  it('GET devolve as faixas do condomínio em ordem', async () => {
    const m = montar({}, [
      { id_condominio: 1, ...SEG_LOCAL },
      { id_condominio: 1, ...SEG_CENTRAL },
      { id_condominio: 2, dia_semana: 0, inicio: '00:00', fim: '24:00', destino: 'central' },
    ]);
    const c = new CrmInterfoneController(m.svc);
    await expect(c.agenda(1)).resolves.toEqual([SEG_CENTRAL, SEG_LOCAL]);
    await expect(c.agenda(999)).rejects.toMatchObject({ status: 404 });
  });

  it('PUT troca a agenda inteira e audita', async () => {
    const m = montar({}, [{ id_condominio: 1, dia_semana: 3, inicio: '10:00', fim: '11:00', destino: 'central' }]);
    const c = new CrmInterfoneController(m.svc);
    await expect(c.salvarAgenda(1, [SEG_LOCAL, SEG_CENTRAL], ADMIN)).resolves.toEqual([SEG_CENTRAL, SEG_LOCAL]);
    expect(m.agenda.linhas().filter((l) => l.id_condominio === 1)).toHaveLength(2);
    expect(m.auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'INTERFONE_CONFIG', id_condominio: 1 }));
    // Lista vazia = sem agenda (local).
    await expect(c.salvarAgenda(1, [], ADMIN)).resolves.toEqual([]);
  });

  it('agenda sobreposta é recusada (400 agenda_invalida) e nada muda', async () => {
    const m = montar({}, [{ id_condominio: 1, ...SEG_CENTRAL }]);
    const c = new CrmInterfoneController(m.svc);
    await expect(
      c.salvarAgenda(1, [SEG_CENTRAL, { dia_semana: 1, inicio: '06:00', fim: '08:00', destino: 'local' }], ADMIN),
    ).rejects.toMatchObject({ status: 400, response: expect.objectContaining({ motivo: 'agenda_invalida' }) });
    expect(m.agenda.linhas()).toHaveLength(1);
    await expect(c.salvarAgenda(1, 'x' as any, ADMIN)).rejects.toMatchObject({ status: 400 });
    await expect(c.salvarAgenda(1, [{ ...SEG_CENTRAL, destino: 'ia' as any }], ADMIN)).rejects.toMatchObject({ status: 400 });
    expect(m.agenda.delegado.deleteMany).not.toHaveBeenCalled();
  });

  it('rotas sob CrmAdminGuard', () => {
    expect(Reflect.getMetadata('__guards__', CrmInterfoneController)).toContain(CrmAdminGuard);
  });
});

describe('síndico: central contratada', () => {
  it('GET config traz central_contratada e a agenda (só leitura); sem central, agenda vazia', async () => {
    const m = montar({ central_contratada: 1 }, [{ id_condominio: 1, ...SEG_CENTRAL }]);
    await expect(m.svc.config(1)).resolves.toMatchObject({
      central_contratada: true,
      transferir: true,
      transferir_travado: true,
      agenda: [SEG_CENTRAL],
    });
    const sem = montar({ interfone_transferir: 0 }, [{ id_condominio: 1, ...SEG_CENTRAL }]);
    await expect(sem.svc.config(1)).resolves.toMatchObject({
      central_contratada: false,
      transferir: false,
      transferir_travado: false,
      agenda: [],
    });
  });

  it('síndico não consegue desligar transferir com central contratada', async () => {
    const m = montar({ central_contratada: 1 });
    const r = await m.svc.salvarConfig(1, { transferir: false, toque_apto_s: 40 }, SINDICO);
    expect(r).toMatchObject({ transferir: true, transferir_travado: true, toque_apto_s: 40 });
    expect(m.cond1().interfone_transferir).toBe(1);
    expect(m.cond1().interfone_toque_apto_s).toBe(40);
    // Valor inválido no transferir também é ignorado com a central (não é escolha do síndico).
    await expect(m.svc.salvarConfig(1, { transferir: 'sim' } as any, SINDICO)).resolves.toMatchObject({ transferir: true });
  });

  it('sem central o transferir segue a escolha do síndico', async () => {
    const m = montar();
    await expect(m.svc.salvarConfig(1, { transferir: false }, SINDICO)).resolves.toMatchObject({ transferir: false, transferir_travado: false });
    expect(m.cond1().interfone_transferir).toBe(0);
  });

  it('ramal igual ao número da portaria com central contratada → 400 ramal_conflita_portaria', async () => {
    const m = montar({ central_contratada: 1, interfone_numero_portaria: '9' });
    await expect(m.svc.salvarRamais(1, [{ id_apartamento: 102, ramal: '9' }], SINDICO)).rejects.toMatchObject({
      status: 400,
      response: { erros: [expect.objectContaining({ id_apartamento: 102, ramal: '9', motivo: 'ramal_conflita_portaria' })] },
    });
    expect(m.tabelas['apartamentos'].find((a: any) => a.id === 102).interfone_ramal).toBeNull();
    // Sem central o "0 = portaria" não vale: o mesmo número é aceito.
    const sem = montar({ central_contratada: 0, interfone_numero_portaria: '9' });
    await sem.svc.salvarRamais(1, [{ id_apartamento: 102, ramal: '9' }], SINDICO);
    expect(sem.tabelas['apartamentos'].find((a: any) => a.id === 102).interfone_ramal).toBe('9');
  });
});

import { OcorrenciasService } from './ocorrencias.service';
import { OcorrenciasController } from './ocorrencias.controller';
import { autorOcorrencia } from './autor-ocorrencia.util';
import { CrmService } from '../crm/crm.service';
import { FacialService } from '../facial/facial.service';
import { MobileAuthService } from '../auth/mobile-auth.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Ocorrência aberta pelo porteiro do console ficava sem autor (o token dele
 * não tem Users.id) e o rótulo saía "Autor: Morador" — a mesma coisa para a
 * aberta pelo suporte da Prestare no CRM. A coluna `origem` (com
 * `id_funcionario_portaria`) diz quem abriu.
 */
describe('Ocorrências — autoria da portaria, do CRM e do sistema', () => {
  const porteiro: JwtPayload = {
    sub: 3, nome: 'João', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria',
  };
  const sindicoConsole: JwtPayload = { sub: 7, nome: 'Síndico', id_condominio: 1, turno: 'Síndico', typeAccess: 'Sindico' };

  describe('rótulo (autorOcorrencia)', () => {
    it('portaria, com e sem o nome do funcionário', () => {
      expect(autorOcorrencia(null, 'Manutenção', 'portaria', 'João')).toBe('Portaria · João');
      expect(autorOcorrencia(null, 'Manutenção', 'portaria', null)).toBe('Portaria');
    });
    it('crm → "Suporte Prestare"; sistema → "Sistema"', () => {
      expect(autorOcorrencia(null, 'Manutenção', 'crm')).toBe('Suporte Prestare');
      expect(autorOcorrencia(null, 'Dispositivos', 'sistema')).toBe('Sistema');
    });
    it('legado sem origem continua como antes', () => {
      expect(autorOcorrencia('Maria', 'Geral', null)).toBe('Maria');
      expect(autorOcorrencia(null, 'Geral', null)).toBe('Morador');
      expect(autorOcorrencia(null, 'Dispositivos', undefined)).toBe('Sistema');
    });
  });

  function montarOcorrencias() {
    const prisma: any = {
      isConnected: true,
      ocorrencias: {
        create: jest.fn(async ({ data }: any) => ({ id: 9, ...data })),
        findMany: jest.fn(async () => [
          {
            id: 9, descricao: 'x', anexos: null, status: 'Pendente', resposta: null, resposta_at: null,
            tipo: 2, prazo: null, id_responsavel: null, created_at: new Date(), publica: false,
            user: null, origem: 'portaria', id_funcionario_portaria: 3,
            categoria: { nome: 'Manutenção', sla_horas: null }, criadoPor: null, funcionarioPortaria: { nome: 'João' },
          },
        ]),
      },
      ocorrencias_Categorias: { findUnique: jest.fn(async () => ({ sla_horas: null })) },
      users: { findMany: jest.fn(async () => []) },
    };
    const storage: any = { exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const tenant: any = { assertEntidade: jest.fn(), assertPermissaoFuncionario: jest.fn() };
    const svc = new OcorrenciasService(prisma, {} as any, tenant, storage);
    return { svc, prisma };
  }

  it('aberta pelo porteiro do console grava origem "portaria" e o funcionário', async () => {
    const { svc, prisma } = montarOcorrencias();
    const ctrl = new OcorrenciasController(svc);
    await ctrl.create(1, porteiro, { descricao: 'Lâmpada queimada', tipo: 2 } as any);
    const data = prisma.ocorrencias.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ user: null, origem: 'portaria', id_funcionario_portaria: 3 });
  });

  it('o corpo não escolhe a origem: síndico mandando origem/id no body grava como usuário', async () => {
    const { svc, prisma } = montarOcorrencias();
    const ctrl = new OcorrenciasController(svc);
    await ctrl.create(1, sindicoConsole, { descricao: 'x', tipo: 2, origem: 'crm', id_funcionario_portaria: 99 } as any);
    const data = prisma.ocorrencias.create.mock.calls[0][0].data;
    expect(data.user).toBe(7);
    expect(data.origem ?? null).toBeNull();
    expect(data.id_funcionario_portaria ?? null).toBeNull();
  });

  it('a lista do console mostra "Portaria · João"', async () => {
    const { svc, prisma } = montarOcorrencias();
    const [o] = await svc.findAll(1, undefined, porteiro);
    expect(o.criadoPorNome).toBe('Portaria · João');
    expect(prisma.ocorrencias.findMany.mock.calls[0][0].include.funcionarioPortaria).toBeTruthy();
  });

  it('aberta pelo CRM grava origem "crm"', async () => {
    const prisma: any = { isConnected: true, ocorrencias: { create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })) } };
    const crm = new CrmService(prisma, {} as any, {} as any);
    await crm.criarOcorrencia(1, 'Visita técnica');
    expect(prisma.ocorrencias.create.mock.calls[0][0].data.origem).toBe('crm');
  });

  it('o chamado automático do monitor de dispositivos grava origem "sistema"', async () => {
    const prisma: any = {
      isConnected: true,
      auditLog: { findFirst: jest.fn(async () => null) },
      ocorrencias: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({ id: 1 })) },
      ocorrencias_Categorias: { findFirst: jest.fn(async () => ({ id: 9, nome: 'Dispositivos' })) },
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const agent: any = { reportDeviceStatus: jest.fn(async () => ({ shouldOpenTicket: true })) };
    const svc = new FacialService(
      prisma, null as any, null as any, null as any, auditoria, null as any, agent, null as any, null as any, null as any,
    );
    await (svc as any).handleDeviceStatusTransition({ id: 4, nome: 'Entrada', tipo: 'facial', id_condominio: 1 }, false);
    expect(prisma.ocorrencias.create.mock.calls[0][0].data.origem).toBe('sistema');
  });

  it('o app recebe criado_por "Portaria · João" (string, como antes); legado sem autor segue vazio', async () => {
    const base = {
      id: 9, id_condominio: 1, publica: true, descricao: 'x', status: 'Pendente', id_responsavel: null,
      categoria: { nome: 'Manutenção' }, criadoPor: null, user: null,
    };
    const prisma: any = {
      isConnected: true,
      ocorrencias: { findUnique: jest.fn() },
      users: { findUnique: jest.fn(async () => null) },
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const app = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, tenant, {} as any);
    const morador = { sub: 100, typeAccess: 'Morador', user: { id: 100 } } as any;

    prisma.ocorrencias.findUnique.mockResolvedValueOnce({
      ...base, origem: 'portaria', id_funcionario_portaria: 3, funcionarioPortaria: { nome: 'João' },
    });
    const daPortaria: any = await app.getOcorrenciaById(9, morador);
    expect(daPortaria.criado_por).toBe('Portaria · João');
    expect(prisma.ocorrencias.findUnique.mock.calls[0][0].include.funcionarioPortaria).toBeTruthy();

    prisma.ocorrencias.findUnique.mockResolvedValueOnce({ ...base, origem: null, funcionarioPortaria: null });
    const legado: any = await app.getOcorrenciaById(9, morador);
    expect(legado.criado_por).toBe('');
  });
});

import { MobileAuthService } from './mobile-auth.service';

describe('MobileAuthService.getMeusEventos — perfil Funcionario / Porteiro', () => {
  const ID_USER_FUNCIONARIO = 35;
  const ID_CONDOMINIO = 2;

  function build() {
    const prisma: any = {
      isConnected: true,
      funcionarios: {
        findFirst: jest.fn(async () => ({
          id: 1,
          id_user: ID_USER_FUNCIONARIO,
          id_condominio: ID_CONDOMINIO,
          nome: 'Porteiro Silva',
        })),
      },
      moradores: { findMany: jest.fn(async () => []) },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
      visitantes: {
        findMany: jest.fn(async (args) => {
          if (args?.where?.id_condominio === ID_CONDOMINIO) {
            return [
              {
                id: 10,
                nome: 'Visitante Condomínio',
                id_condominio: ID_CONDOMINIO,
                is_prestador: 0,
                data_entrada: new Date(Date.now() - 3600 * 1000),
                data_saida: null,
              },
            ];
          }
          return [];
        }),
      },
      acessos_Facial: {
        findMany: jest.fn(async (args) => {
          if (args?.where?.id_condominio === ID_CONDOMINIO) {
            return [
              {
                id: 501,
                id_pessoa: 88,
                id_condominio: ID_CONDOMINIO,
                nome_pessoa: 'Morador Teste (101)',
                evento: 'entrada',
                tipo_pessoa: 'morador',
                tipo_dispositivo: 'facial',
                confianca: 98,
                timestamp: new Date(Date.now() - 1800 * 1000),
              },
            ];
          }
          return [];
        }),
      },
      condominios: {
        findMany: jest.fn(async () => [{ id: ID_CONDOMINIO, nome: 'Residencial Prestare' }]),
      },
    };

    const svc = new MobileAuthService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, prisma };
  }

  it('retorna eventos de todo o condomínio quando typeAccess for Funcionario', async () => {
    const { svc } = build();

    const eventos = await svc.getMeusEventos(ID_USER_FUNCIONARIO, 15, 'Funcionario');

    expect(eventos.length).toBeGreaterThanOrEqual(2);
    const moradorEv = eventos.find((e: any) => e.nome.includes('Morador Teste'));
    expect(moradorEv).toBeDefined();
    expect(moradorEv.tipo_pessoa).toBe('morador');
    expect(moradorEv.condominio).toBe('Residencial Prestare');

    const visitanteEv = eventos.find((e: any) => e.nome.includes('Visitante Condomínio'));
    expect(visitanteEv).toBeDefined();
    expect(visitanteEv.tipo_pessoa).toBe('visitante');
  });
});

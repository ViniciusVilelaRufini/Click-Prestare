import { FacialService } from './facial.service';

describe('FacialService.registrarEvento — coerência dispositivo↔condomínio', () => {
  function build() {
    const criados: any[] = [];
    const prisma: any = {
      isConnected: true,
      acessos_Facial: {
        create: jest.fn(async ({ data }: any) => {
          criados.push(data);
          return { id: criados.length, ...data };
        }),
      },
    };
    // O construtor tem 10 parâmetros, nessa ordem: prisma, client,
    // notifications, enrollSessions, auditoria, accessState, agent, tenant,
    // consentimentos, consentimentosTerceiros. registrarEvento só usa o prisma.
    const svc = new FacialService(
      prisma,
      null as any, null as any, null as any, null as any,
      null as any, null as any, null as any, null as any, null as any,
    );
    return { svc, prisma, criados };
  }

  const leitor = { id: 6, id_condominio: 1, tipo: 'facial', nome: 'Portaria Principal' };
  const abertura = { id: 9, id_condominio: 2, tipo: 'rele', nome: 'Portão Social' };

  it('grava o condomínio DO APARELHO registrado, não o de quem chamou', async () => {
    const { svc, criados } = build();

    // Caminho de acesso: o leitor (cond 1) aciona uma abertura (cond 2).
    // O evento é sobre a ABERTURA, então tem de registrar o condomínio dela.
    await (svc as any).registrarEvento(abertura, {
      face_id: 'morador_10',
      tipo_pessoa: 'morador',
      id_pessoa: 10,
      nome_pessoa: 'Fulano',
      evento: 'entrada',
    });

    expect(criados[0].id_device).toBe(9);
    expect(criados[0].id_condominio).toBe(2);
  });

  it('preenche nome_dispositivo com o nome do aparelho', async () => {
    const { svc, criados } = build();

    await (svc as any).registrarEvento(leitor, {
      face_id: 'trigger_manual',
      tipo_pessoa: 'operador',
      nome_pessoa: 'Operador',
      evento: 'acionado_manual',
    });

    expect(criados[0].nome_dispositivo).toBe('Portaria Principal');
    expect(criados[0].tipo_dispositivo).toBe('facial');
  });

  it('usa null para id_pessoa e confianca quando não informados', async () => {
    const { svc, criados } = build();

    await (svc as any).registrarEvento(leitor, {
      face_id: 'desconhecido',
      tipo_pessoa: 'desconhecido',
      nome_pessoa: 'Não identificado',
      evento: 'negado',
    });

    expect(criados[0].id_pessoa).toBeNull();
    expect(criados[0].confianca).toBeNull();
    expect(criados[0].timestamp).toBeInstanceOf(Date);
  });
});

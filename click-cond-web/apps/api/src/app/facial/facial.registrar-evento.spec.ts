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

  it('preserva o timestamp informado, sem substituir por new Date()', async () => {
    const { svc, criados } = build();
    const ts = new Date('2026-01-15T03:20:00.000Z');

    await (svc as any).registrarEvento(leitor, {
      face_id: 'morador_10',
      tipo_pessoa: 'morador',
      id_pessoa: 10,
      nome_pessoa: 'Fulano',
      evento: 'entrada',
      timestamp: ts,
    });

    // O log de acesso É a evidência num incidente de segurança — se o helper
    // silenciosamente trocasse o timestamp do aparelho pelo "agora" do
    // servidor, essa é a corrupção mais invisível possível (passa em
    // qualquer teste que só cheque toBeInstanceOf(Date)).
    expect(criados[0].timestamp).toBe(ts);
  });
});

describe('FacialService.runWebhook — ponte leitor→abertura grava o dispositivo correto', () => {
  // Regressão-alvo: facial.service.ts:~4088, dentro do laço
  // `for (const abertura of aberturasParaAcionar)`. Antes do helper, esse
  // ponto gravava `id_device: abertura.id` junto de `id_condominio:
  // device.id_condominio` (o LEITOR) — dois objetos distintos. Um teste que
  // só chama registrarEvento(abertura, ...) diretamente não pega alguém
  // revertendo a chamada real para registrarEvento(device, ...); só driblar
  // o webhook de ponta a ponta pega isso.
  function build() {
    const criados: any[] = [];
    const prisma: any = {
      isConnected: true,
      acessos_Facial: {
        create: jest.fn(async ({ data }: any) => {
          criados.push(data);
          return { id: criados.length, ...data };
        }),
        // Sem histórico prévio em nenhuma consulta usada pelo caminho
        // (dedup de backlog, alternância auto, anti-passback por histórico,
        // seed de presença em memória).
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
      },
      moradores: {
        // Credencial RFID resolve para um morador — é o que faz o webhook
        // seguir pelo caminho de identificação bem-sucedida.
        findFirst: jest.fn(async () => ({
          id: 10,
          tipo: 'morador',
          nome: 'Fulano',
          tag_rfid: 'TAG-1',
        })),
      },
      regras_Acesso: {
        // Nenhuma regra ativa: nem bloqueia por horário/categoria, nem
        // mapeia o leitor a uma abertura específica (cai no fallback).
        findMany: jest.fn(async () => []),
      },
      caminhos_Etapas: {
        // Sem caminho configurado: força o roteamento por regras/fallback.
        findFirst: jest.fn(async () => null),
      },
      facial_Devices: {
        // Fallback: todas as aberturas ativas do condomínio do leitor.
        findMany: jest.fn(async () => [abertura]),
      },
    };

    const client: any = {
      triggerRelay: jest.fn(async () => ({ ok: true })),
    };

    const accessState: any = {
      shouldDebounce: jest.fn(() => false),
      hasPresenca: jest.fn(() => true), // pula o seed de presença
      checkAntiPassback: jest.fn(() => 'allow'),
      setPresenca: jest.fn(),
    };

    const svc = new FacialService(
      prisma,
      client,
      null as any, // notifications — não usado neste caminho (só visitante/prestador)
      null as any, // enrollSessions — não usado (pessoa é identificada de primeira)
      null as any, // auditoria — não usado (só no acionamento manual)
      accessState,
      null as any, // agent
      null as any, // tenant
      null as any, // consentimentos
      null as any, // consentimentosTerceiros
    );
    return { svc, prisma, client, criados };
  }

  const leitor = {
    id: 6,
    id_condominio: 1,
    tipo: 'tag_reader',
    nome: 'Leitor Portaria',
    sentido: 'entrada',
    confianca_minima: 0,
  };
  const abertura = {
    id: 9,
    id_condominio: 1,
    tipo: 'rele',
    nome: 'Portão Social',
  };

  it('grava o evento de acionamento automático com id_device e nome_dispositivo DA ABERTURA, não do leitor', async () => {
    const { svc, client, criados } = build();

    await (svc as any).runWebhook(leitor, {
      card_uid: 'TAG-1',
      event: 'entrada',
    });

    expect(client.triggerRelay).toHaveBeenCalledTimes(1);

    const eventoPonte = criados.find((c) => c.evento === 'acionado_auto');
    expect(eventoPonte).toBeDefined();
    expect(eventoPonte.id_device).toBe(abertura.id);
    expect(eventoPonte.nome_dispositivo).toBe(abertura.nome);
    expect(eventoPonte.id_condominio).toBe(abertura.id_condominio);
    // Não é o leitor que disparou a leitura.
    expect(eventoPonte.id_device).not.toBe(leitor.id);
  });
});

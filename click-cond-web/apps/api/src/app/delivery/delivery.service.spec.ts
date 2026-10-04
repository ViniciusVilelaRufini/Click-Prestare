import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DeliveryService } from './delivery.service';

describe('DeliveryService', () => {
  const morador = { sub: 10, typeAccess: 'Morador' } as any;
  const porteiro = { sub: 20, id_condominio: 1, nome: 'Portaria' } as any;
  const sindico = { sub: 30, id_condominio: 1, nome: 'Síndico', typeAccess: 'Sindico', turno: 'Síndico' } as any;
  const administrador = { sub: 31, id_condominio: 1, nome: 'Administrador', turno: 'Administrador' } as any;

  function montar(opcoes: {
    apartamentoDoMorador?: boolean;
    entregadorBloqueado?: boolean;
    entregadorCondominio?: number;
    falhaEvento?: boolean;
    falhaPlacaDuplicada?: boolean;
    transicaoConcorrente?: boolean;
  } = {}) {
    let proximoId = 1;
    const atendimentos: any[] = [];
    const eventos: any[] = [];
    const entregadores: any[] = [{
      id: 7,
      id_condominio: opcoes.entregadorCondominio ?? 1,
      nome: 'Motoboy Teste',
      telefone: '11999999999',
      plataforma: 'Entrega Rápida',
      documento: '12345678900',
      status: opcoes.entregadorBloqueado ? 'BLOQUEADO' : 'ATIVO',
      motivo_bloqueio: opcoes.entregadorBloqueado ? 'Ocorrência interna' : null,
      foto: 'https://interno/foto.jpg',
    }];
    const veiculos: any[] = [];
    const projetar = (valor: any, select: Record<string, any>): any => Object.fromEntries(
      Object.entries(select).flatMap(([campo, regra]) => {
        if (!regra) return [];
        const atual = valor?.[campo];
        if (regra === true) return [[campo, atual]];
        if (regra.select) {
          if (Array.isArray(atual)) return [[campo, atual.map((item) => projetar(item, regra.select))]];
          return [[campo, atual == null ? atual : projetar(atual, regra.select)]];
        }
        return [[campo, atual]];
      }),
    );
    const prisma: any = {
      isConnected: true,
      apartamentos_Users: {
        findFirst: jest.fn(async () => (opcoes.apartamentoDoMorador === false ? null : { id: 1, user: { fcm_token: 'token-morador' } })),
        findMany: jest.fn(async () => [
          { apartamento: { id: 202, id_condominio: 1, bloco: 'B', apto: '202' } },
          { apartamento: { id: 101, id_condominio: 1, bloco: 'A', apto: '101' } },
          { apartamento: { id: 202, id_condominio: 1, bloco: 'B', apto: '202' } },
        ]),
      },
      apartamentos: {
        findUnique: jest.fn(async () => ({ id: 101, id_condominio: 1 })),
      },
      deliveryAtendimentos: {
        create: jest.fn(async ({ data }: any) => {
          const atendimento = { id: proximoId++, ...data, created_at: new Date() };
          atendimentos.push(atendimento);
          return atendimento;
        }),
        findUnique: jest.fn(async ({ where }: any) => atendimentos.find((a) => a.id === where.id) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const atendimento = atendimentos.find((a) => a.id === where.id);
          Object.assign(atendimento, data);
          return atendimento;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (opcoes.transicaoConcorrente) return { count: 0 };
          const atendimento = atendimentos.find((a) => a.id === where.id && a.status === where.status);
          if (!atendimento) return { count: 0 };
          Object.assign(atendimento, data);
          return { count: 1 };
        }),
        findMany: jest.fn(async ({ include, select }: any) => {
          const entregador = {
            ...entregadores[0],
            status: 'BLOQUEADO',
            motivo_bloqueio: 'Ocorrência interna',
          };
          const selecionado = include?.entregador?.select;
          const comVeiculos = include?.entregador?.include?.veiculos === true;
          const registro = {
            id: 91,
            id_condominio: 1,
            id_apartamento: 101,
            id_morador_user: 10,
            id_entregador: 7,
            status: 'CHEGOU',
            estabelecimento: 'Mercado',
            modo_entrega: 'UNIDADE',
            apartamento: { id: 101, bloco: 'A', apto: '101' },
            entregador: selecionado
              ? Object.fromEntries(Object.keys(selecionado).map((campo) => [campo, entregador[campo as keyof typeof entregador]]))
              : comVeiculos
                ? { ...entregador, veiculos: [{ id: 70, placa: 'ABC1D23', tipo: 'Moto' }] }
                : entregador,
            eventos: include?.eventos?.select
              ? [{ status_novo: 'CHEGOU', mensagem: 'Chegou', created_at: new Date() }]
              : [{ id: 88, id_atendimento: 91, id_usuario_autor: 20, autor_nome: 'Portaria', status_novo: 'CHEGOU', mensagem: 'Chegou', created_at: new Date() }],
            created_at: new Date(),
          };
          return [select ? projetar(registro, select) : registro];
        }),
      },
      deliveryEntregadores: {
        create: jest.fn(async ({ data }: any) => {
          const entregador = { id: proximoId++, status: 'ATIVO', ...data };
          entregadores.push(entregador);
          return entregador;
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const entregador = entregadores.find((item) => item.id === where.id) ?? null;
          if (!entregador) return null;
          return { ...entregador, veiculos: veiculos.filter((item) => item.id_entregador === entregador.id) };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const entregador = entregadores.find((item) => item.id === where.id);
          Object.assign(entregador, data);
          return entregador;
        }),
      },
      deliveryVeiculos: {
        create: jest.fn(async ({ data }: any) => {
          if (opcoes.falhaPlacaDuplicada) throw Object.assign(new Error('duplicada'), { code: 'P2002' });
          const veiculo = { id: proximoId++, ...data };
          veiculos.push(veiculo);
          return veiculo;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          if (opcoes.falhaPlacaDuplicada) throw Object.assign(new Error('duplicada'), { code: 'P2002' });
          const veiculo = veiculos.find((item) => item.id === where.id);
          Object.assign(veiculo, data);
          return veiculo;
        }),
        deleteMany: jest.fn(async ({ where }: any) => {
          const restantes = veiculos.filter((item) => item.id_entregador !== where.id_entregador);
          const count = veiculos.length - restantes.length;
          veiculos.splice(0, veiculos.length, ...restantes);
          return { count };
        }),
      },
      deliveryEventos: {
        create: jest.fn(async ({ data }: any) => {
          if (opcoes.falhaEvento) throw new Error('evento indisponível');
          eventos.push(data);
          return data;
        }),
      },
    };
    prisma.$transaction = jest.fn(async (callback: (tx: any) => Promise<any>) => {
      const antes = atendimentos.map((atendimento) => ({ ...atendimento }));
      const eventosAntes = eventos.map((evento) => ({ ...evento }));
      const entregadoresAntes = entregadores.map((entregador) => ({ ...entregador }));
      const veiculosAntes = veiculos.map((veiculo) => ({ ...veiculo }));
      try {
        return await callback(prisma);
      } catch (erro) {
        atendimentos.splice(0, atendimentos.length, ...antes);
        eventos.splice(0, eventos.length, ...eventosAntes);
        entregadores.splice(0, entregadores.length, ...entregadoresAntes);
        veiculos.splice(0, veiculos.length, ...veiculosAntes);
        throw erro;
      }
    });
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
    return {
      service: new DeliveryService(prisma, notifications, tenant),
      atendimentos,
      eventos,
      entregadores,
      veiculos,
      notifications,
      prisma,
    };
  }

  it('recusa aviso de morador para apartamento sem vínculo', async () => {
    const { service } = montar({ apartamentoDoMorador: false });

    await expect(service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('preserva nome e telefone opcionais do entregador informados no aviso', async () => {
    const { service, atendimentos } = montar();

    await service.criarAviso({
      id_condominio: 1,
      id_apartamento: 101,
      nome_entregador: 'Motoboy Teste',
      telefone_entregador: '11999999999',
    } as any, morador);

    expect(atendimentos[0]).toMatchObject({
      nome_entregador: 'Motoboy Teste',
      telefone_entregador: '11999999999',
    });
  });

  it('minimiza identificadores internos na resposta de criação ao morador', async () => {
    const { service } = montar();

    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);

    expect(aviso).toMatchObject({ id: expect.any(Number), status: 'AGENDADA' });
    expect(aviso).not.toHaveProperty('id_condominio');
    expect(aviso).not.toHaveProperty('id_apartamento');
    expect(aviso).not.toHaveProperty('id_morador_user');
    expect(aviso).not.toHaveProperty('id_entregador');
  });

  it('lista somente campos seguros dos vínculos de unidade do morador sem duplicar', async () => {
    const { service } = montar();

    const unidades = await service.listarUnidadesMorador(1, morador);

    expect(unidades).toEqual([
      { id: 101, bloco: 'A', apto: '101' },
      { id: 202, bloco: 'B', apto: '202' },
    ]);
  });

  it('oculta documento, bloqueio e motivos do entregador na listagem do morador', async () => {
    const { service } = montar();

    const [atendimento] = await service.listarAtendimentos(1, undefined, morador);

    expect(atendimento.entregador).toEqual({
      nome: 'Motoboy Teste',
      telefone: '11999999999',
      plataforma: 'Entrega Rápida',
    });
    expect(atendimento.eventos).toEqual([
      expect.objectContaining({ status_novo: 'CHEGOU', mensagem: 'Chegou' }),
    ]);
    expect(atendimento.eventos[0]).not.toHaveProperty('id');
    expect(atendimento.eventos[0]).not.toHaveProperty('id_usuario_autor');
    expect(atendimento.eventos[0]).not.toHaveProperty('autor_nome');
    expect(atendimento.entregador).not.toHaveProperty('id');
    expect(atendimento.entregador).not.toHaveProperty('documento');
    expect(atendimento.entregador).not.toHaveProperty('status');
    expect(atendimento.entregador).not.toHaveProperty('motivo_bloqueio');
    expect(atendimento.entregador).not.toHaveProperty('foto');
  });

  it('não expõe chaves internas desnecessárias na listagem do morador', async () => {
    const { service } = montar();

    const [atendimento] = await service.listarAtendimentos(1, undefined, morador);

    expect(atendimento).not.toHaveProperty('id_condominio');
    expect(atendimento).not.toHaveProperty('id_apartamento');
    expect(atendimento).not.toHaveProperty('id_morador_user');
    expect(atendimento).not.toHaveProperty('id_entregador');
    expect(atendimento.apartamento).toEqual({ bloco: 'A', apto: '101' });
  });

  it('mantém dados completos do entregador na listagem operacional da portaria', async () => {
    const { service } = montar();

    const [atendimento] = await service.listarAtendimentos(1, undefined, porteiro);

    expect(atendimento.entregador).toMatchObject({
      documento: '12345678900',
      status: 'BLOQUEADO',
      motivo_bloqueio: 'Ocorrência interna',
    });
  });

  it('inclui os veículos do entregador na listagem operacional', async () => {
    const { service } = montar();

    const [atendimento] = await service.listarAtendimentos(1, undefined, porteiro);

    expect(atendimento.entregador.veiculos).toEqual([
      expect.objectContaining({ placa: 'ABC1D23', tipo: 'Moto' }),
    ]);
  });

  it('conduz o atendimento de AGENDADA até CONCLUIDA e registra cada transição', async () => {
    const { service, atendimentos, eventos, notifications } = montar();
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);

    await service.atualizarStatus(aviso.id, { status: 'CHEGOU', id_entregador: 7 }, porteiro);
    await service.atualizarStatus(aviso.id, { status: 'AUTORIZADA' }, porteiro);
    await service.atualizarStatus(aviso.id, { status: 'CONCLUIDA' }, porteiro);

    expect(atendimentos[0]).toMatchObject({ status: 'CONCLUIDA', chegou_em: expect.any(Date), autorizado_em: expect.any(Date), concluido_em: expect.any(Date) });
    expect(eventos.map((evento) => evento.status_novo)).toEqual(['AGENDADA', 'CHEGOU', 'AUTORIZADA', 'CONCLUIDA']);
    expect(notifications.sendPushNotification).toHaveBeenCalledTimes(3);
  });

  it('recusa transição para RECUSADA sem motivo', async () => {
    const { service } = montar();
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
    await service.atualizarStatus(aviso.id, { status: 'CHEGOU' }, porteiro);

    await expect(service.atualizarStatus(aviso.id, { status: 'RECUSADA' }, porteiro))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('minimiza identificadores internos na resposta de cancelamento ao morador', async () => {
    const { service } = montar();
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);

    const cancelado = await service.atualizarStatus(
      aviso.id,
      { status: 'CANCELADA', motivo: 'Desisti da entrega' },
      morador,
    );

    expect(cancelado).toMatchObject({ id: aviso.id, status: 'CANCELADA' });
    expect(cancelado).not.toHaveProperty('id_condominio');
    expect(cancelado).not.toHaveProperty('id_apartamento');
    expect(cancelado).not.toHaveProperty('id_morador_user');
    expect(cancelado).not.toHaveProperty('id_entregador');
  });

  it('impede autorização quando o entregador associado está bloqueado', async () => {
    const { service } = montar({ entregadorBloqueado: true });
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
    await service.atualizarStatus(aviso.id, { status: 'CHEGOU', id_entregador: 7 }, porteiro);

    await expect(service.atualizarStatus(aviso.id, { status: 'AUTORIZADA' }, porteiro))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('não associa entregador de outro condomínio ao atendimento', async () => {
    const { service } = montar({ entregadorCondominio: 2 });
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);

    await expect(service.atualizarStatus(aviso.id, { status: 'CHEGOU', id_entregador: 7 }, porteiro))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('envia a atualização somente ao token do morador que criou o aviso', async () => {
    const { service, notifications, prisma } = montar();
    prisma.apartamentos_Users.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.id_user === 10) return { id: 1 };
      if (where.id_user === undefined && where.id_apto === 101) return { id: 2, user: { fcm_token: 'token-outro-morador' } };
      return null;
    });
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
    prisma.apartamentos_Users.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.id_user === 10 && where.id_apto === 101) return { id: 1, user: { fcm_token: 'token-solicitante' } };
      return { id: 2, user: { fcm_token: 'token-outro-morador' } };
    });

    await service.atualizarStatus(aviso.id, { status: 'CHEGOU' }, porteiro);

    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'token-solicitante', expect.any(String), expect.any(String), expect.any(Object),
    );
  });

  it('desfaz a alteração de status quando o evento de auditoria falha', async () => {
    const { service, atendimentos, prisma } = montar();
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
    prisma.deliveryEventos.create.mockRejectedValueOnce(new Error('evento indisponível'));

    await expect(service.atualizarStatus(aviso.id, { status: 'CHEGOU' }, porteiro))
      .rejects.toThrow('evento indisponível');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(atendimentos[0].status).toBe('AGENDADA');
  });

  it('desfaz a criação do aviso quando o evento inicial falha', async () => {
    const { service, atendimentos, prisma } = montar({ falhaEvento: true });

    await expect(service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador))
      .rejects.toThrow('evento indisponível');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(atendimentos).toHaveLength(0);
  });

  it('recusa a transição quando outra requisição já alterou o status lido', async () => {
    const { service, eventos } = montar({ transicaoConcorrente: true });
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);

    await expect(service.atualizarStatus(aviso.id, { status: 'CHEGOU', id_entregador: 7 }, porteiro))
      .rejects.toBeInstanceOf(ConflictException);

    expect(eventos.map((evento) => evento.status_novo)).toEqual(['AGENDADA']);
  });

  it('exige entregador associado antes de autorizar o atendimento', async () => {
    const { service } = montar();
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
    await service.atualizarStatus(aviso.id, { status: 'CHEGOU' }, porteiro);

    await expect(service.atualizarStatus(aviso.id, { status: 'AUTORIZADA' }, porteiro))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  describe('resposta do morador a "aguardando autorização"', () => {
    async function aguardando(montado: ReturnType<typeof montar>) {
      const aviso = await montado.service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
      await montado.service.atualizarStatus(aviso.id, { status: 'CHEGOU' }, porteiro);
      await montado.service.atualizarStatus(aviso.id, { status: 'AGUARDANDO_AUTORIZACAO' }, porteiro);
      montado.notifications.sendPushNotification.mockClear();
      return aviso;
    }

    it('o morador autoriza, mesmo sem entregador identificado', async () => {
      const m = montar();
      const aviso = await aguardando(m);

      await m.service.atualizarStatus(aviso.id, { status: 'AUTORIZADA' }, morador);

      expect(m.atendimentos[0]).toMatchObject({ status: 'AUTORIZADA', autorizado_em: expect.any(Date) });
      // Ele mesmo deu a resposta: não recebe push da própria ação.
      expect(m.notifications.sendPushNotification).not.toHaveBeenCalled();
    });

    it('o morador recusa com motivo', async () => {
      const m = montar();
      const aviso = await aguardando(m);

      await m.service.atualizarStatus(aviso.id, { status: 'RECUSADA', motivo: 'Não pedi nada' }, morador);

      expect(m.atendimentos[0]).toMatchObject({ status: 'RECUSADA', motivo: 'Não pedi nada' });
    });

    it('o morador não avança outros status', async () => {
      const m = montar();
      const aviso = await m.service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
      await m.service.atualizarStatus(aviso.id, { status: 'CHEGOU' }, porteiro);

      await expect(m.service.atualizarStatus(aviso.id, { status: 'AUTORIZADA' }, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('outro morador não responde pelo aviso', async () => {
      const m = montar();
      const aviso = await aguardando(m);
      const vizinho = { sub: 99, typeAccess: 'Morador' } as any;

      await expect(m.service.atualizarStatus(aviso.id, { status: 'AUTORIZADA' }, vizinho))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('avisa o morador quando a entrega é recusada, com o motivo', async () => {
    const { service, notifications } = montar();
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
    await service.atualizarStatus(aviso.id, { status: 'CHEGOU' }, porteiro);
    notifications.sendPushNotification.mockClear();

    await service.atualizarStatus(aviso.id, { status: 'RECUSADA', motivo: 'Entregador sem identificação' }, porteiro);

    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'token-morador',
      'Delivery',
      'Sua entrega foi recusada pela portaria. Motivo: Entregador sem identificação',
      expect.objectContaining({ status: 'RECUSADA' }),
    );
  });

  it('avisa o morador quando a entrega fica na portaria', async () => {
    const { service, notifications } = montar();
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
    await service.atualizarStatus(aviso.id, { status: 'CHEGOU' }, porteiro);
    notifications.sendPushNotification.mockClear();

    await service.atualizarStatus(aviso.id, { status: 'RETIRADA_NA_PORTARIA' }, porteiro);

    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'token-morador',
      'Delivery',
      'Sua entrega ficou na portaria. Retire quando puder.',
      expect.objectContaining({ status: 'RETIRADA_NA_PORTARIA' }),
    );
  });

  it('notifica o morador quando a portaria solicita autorização', async () => {
    const { service, notifications } = montar();
    const aviso = await service.criarAviso({ id_condominio: 1, id_apartamento: 101 }, morador);
    await service.atualizarStatus(aviso.id, { status: 'CHEGOU', id_entregador: 7 }, porteiro);
    notifications.sendPushNotification.mockClear();

    await service.atualizarStatus(aviso.id, { status: 'AGUARDANDO_AUTORIZACAO' }, porteiro);

    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'token-morador',
      'Delivery',
      'A portaria aguarda sua autorização para a entrega.',
      expect.objectContaining({ status: 'AGUARDANDO_AUTORIZACAO' }),
    );
  });

  it('impede porteiro de editar ou bloquear cadastro de entregador', async () => {
    const { service } = montar();

    await expect(service.atualizarEntregador(7, { status: 'BLOQUEADO', motivo_bloqueio: 'Ocorrência' }, porteiro))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permite ao síndico editar cadastro de entregador', async () => {
    const { service } = montar();

    await expect(service.atualizarEntregador(7, { nome: 'Nome revisado' }, sindico))
      .resolves.toMatchObject({ nome: 'Nome revisado' });
  });

  it('permite ao administrador editar cadastro de entregador', async () => {
    const { service } = montar();

    await expect(service.atualizarEntregador(7, { nome: 'Nome revisado' }, administrador))
      .resolves.toMatchObject({ nome: 'Nome revisado' });
  });

  it('desfaz o cadastro do entregador quando a placa duplicada impede criar o veículo', async () => {
    const { service, entregadores } = montar({ falhaPlacaDuplicada: true });

    await expect(service.criarEntregador({
      id_condominio: 1,
      nome: 'Novo Motoboy',
      veiculo: { placa: 'ABC-1D23' },
    }, porteiro)).rejects.toBeInstanceOf(ConflictException);

    expect(entregadores.map((entregador) => entregador.nome)).not.toContain('Novo Motoboy');
  });

  it('devolve o veículo criado junto com o cadastro do entregador', async () => {
    const { service } = montar();

    const criado = await service.criarEntregador({
      id_condominio: 1,
      nome: 'Novo Motoboy',
      veiculo: { placa: 'abc-1d23', tipo: 'Moto' },
    }, porteiro);

    expect(criado.veiculos).toEqual([
      expect.objectContaining({ placa: 'ABC1D23', tipo: 'Moto' }),
    ]);
  });

  it('permite ao síndico adicionar e corrigir o veículo depois do cadastro', async () => {
    const { service } = montar();

    const atualizado = await service.atualizarEntregador(7, {
      veiculo: { placa: 'xyz-9a87', tipo: 'Moto', modelo: 'CG', cor: 'Preta' },
    } as any, sindico);

    expect(atualizado.veiculos).toEqual([
      expect.objectContaining({ placa: 'XYZ9A87', tipo: 'Moto', modelo: 'CG', cor: 'Preta' }),
    ]);
  });

  it('permite ao síndico remover os veículos do cadastro', async () => {
    const { service, veiculos } = montar();
    veiculos.push({ id: 80, id_entregador: 7, id_condominio: 1, placa: 'ABC1D23', tipo: 'Moto' });

    const atualizado = await service.atualizarEntregador(7, { veiculo: null } as any, sindico);

    expect(atualizado.veiculos).toEqual([]);
    expect(veiculos).toHaveLength(0);
  });

  it('desfaz a edição do entregador quando a nova placa já existe', async () => {
    const { service, entregadores, veiculos } = montar({ falhaPlacaDuplicada: true });
    veiculos.push({ id: 80, id_entregador: 7, id_condominio: 1, placa: 'ABC1D23', tipo: 'Moto' });

    await expect(service.atualizarEntregador(7, {
      nome: 'Nome parcial',
      veiculo: { placa: 'DUP-1A23', tipo: 'Moto' },
    } as any, sindico)).rejects.toBeInstanceOf(ConflictException);

    expect(entregadores.find((entregador) => entregador.id === 7)?.nome).toBe('Motoboy Teste');
  });

  describe('escopos da listagem operacional', () => {
    afterEach(() => jest.useRealTimers());

    it('escopo=ativos exclui terminais', async () => {
      const { service, prisma } = montar();
      await service.listarAtendimentos(1, undefined, porteiro, { escopo: 'ativos' });
      const { where } = prisma.deliveryAtendimentos.findMany.mock.calls[0][0];
      expect(where.AND).toEqual([{ status: { notIn: ['CONCLUIDA', 'CANCELADA', 'RECUSADA'] } }]);
      expect(where.created_at).toBeUndefined();
    });

    it('escopo=historico usa últimos 30 dias, ate inclusivo e limite de 500', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-04T15:00:00Z'));
      const { service, prisma } = montar();
      await service.listarAtendimentos(1, undefined, porteiro, { escopo: 'historico' });
      const args = prisma.deliveryAtendimentos.findMany.mock.calls[0][0];
      expect(args.where.AND).toEqual([{ status: { in: ['CONCLUIDA', 'CANCELADA', 'RECUSADA'] } }]);
      expect(args.where.created_at).toEqual({
        gte: new Date('2026-09-05T00:00:00-03:00'),
        lte: new Date('2026-10-04T23:59:59.999-03:00'),
      });
      expect(args.take).toBe(500);
    });

    it('escopo=historico respeita de/ate informados', async () => {
      const { service, prisma } = montar();
      await service.listarAtendimentos(1, undefined, sindico, { escopo: 'historico', de: '2026-10-01', ate: '2026-10-02' });
      expect(prisma.deliveryAtendimentos.findMany.mock.calls[0][0].where.created_at).toEqual({
        gte: new Date('2026-10-01T00:00:00-03:00'),
        lte: new Date('2026-10-02T23:59:59.999-03:00'),
      });
    });

    it('rejeita escopo inválido e datas malformadas', async () => {
      const { service } = montar();
      await expect(service.listarAtendimentos(1, undefined, porteiro, { escopo: 'tudo' }))
        .rejects.toBeInstanceOf(BadRequestException);
      await expect(service.listarAtendimentos(1, undefined, porteiro, { escopo: 'historico', de: '01/10/2026' }))
        .rejects.toBeInstanceOf(BadRequestException);
      await expect(service.listarAtendimentos(1, undefined, porteiro, { escopo: 'historico', de: '2026-10-05', ate: '2026-10-01' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('morador ignora escopo e mantém o formato atual', async () => {
      const { service, prisma } = montar();
      await service.listarAtendimentos(1, undefined, morador, { escopo: 'tudo' });
      const args = prisma.deliveryAtendimentos.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ id_condominio: 1, id_morador_user: 10 });
      expect(args.take).toBeUndefined();
    });

    it('sem escopo o operador recebe a listagem de sempre', async () => {
      const { service, prisma } = montar();
      await service.listarAtendimentos(1, undefined, porteiro);
      const args = prisma.deliveryAtendimentos.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ id_condominio: 1 });
      expect(args.take).toBeUndefined();
    });
  });
});

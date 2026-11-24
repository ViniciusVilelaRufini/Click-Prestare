import { BadRequestException, ConflictException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';
import { gravacaoCondicional, gravacaoCondicionalMapa } from './where-falso.testutil';

/**
 * Varredura 24/11 — portaria remota sem corridas.
 *
 * P4: autorizar e negar ao mesmo tempo passavam os dois pela leitura
 * (`assertPedidoPendente`) e a última gravação vencia. A reprodução da
 * varredura segura as duas requisições numa barreira depois da leitura e
 * só então deixa as duas gravarem. Variante: check-in/liberar do console
 * liam "sem negativa" e um negar entre a leitura e a gravação era
 * sobrescrito com `liberado=1`.
 * K1: redirecionar o pedido para outra unidade deixava o pedido da unidade
 * original respondível (e o card dele aberto).
 * P3: no legado, Liberar/Solicitar zeravam a entrada de quem está dentro.
 * P1 resto: o legado não mostrava a negativa recente na lista.
 */

/** Libera todos quando `n` chegaram (as leituras terminam antes de qualquer gravação). */
function barreira(n: number) {
  let chegaram = 0;
  let abrir!: () => void;
  const aberta = new Promise<void>((r) => (abrir = r));
  return async () => {
    chegaram++;
    if (chegaram >= n) abrir();
    await aberta;
  };
}

const minutosAtras = (m: number) => new Date(Date.now() - m * 60_000);
const morador = { sub: 50, nome: 'QA morador', typeAccess: 'Morador', user: { id: 50 } } as any;
const outroMorador = { sub: 51, nome: 'QA morador 2', typeAccess: 'Morador', user: { id: 51 } } as any;
const porteiro = { sub: 3, nome: 'Portaria', id_condominio: 1, turno: 'Manha' } as any;

function servico(prisma: any, card?: any) {
  const auditoria = { registrar: jest.fn(async () => ({})) };
  const realtime = { emitToCondominio: jest.fn() };
  const facial = { syncVisitante: jest.fn(async () => ({ ok: true })), syncPessoa: jest.fn(async () => ({})) };
  const svc = new VisitantesService(
    prisma, { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() } as any, { isDataUrl: () => false } as any,
    facial as any, auditoria as any, { assertCondominio: jest.fn(async () => undefined) } as any, realtime as any,
    {} as any, card,
  );
  return { svc, auditoria, realtime };
}

function cardFalso() {
  return {
    abrir: jest.fn(async () => undefined),
    respondido: jest.fn(async () => undefined),
    entrou: jest.fn(async () => undefined),
    encerrar: jest.fn(async () => undefined),
  };
}

describe('Portaria remota — corridas (varredura 24/11)', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  describe('Pessoas/Visitas', () => {
    function montar(extra: Record<string, unknown> = {}, leituras = 2) {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const pessoa = { id: 2000001, nome: 'QA_Corrida', bloqueado: 0, foto_pessoa: null };
      const visita: any = {
        id: 1000004, id_pessoa: 2000001, id_condominio: 1, id_apartamento: 106, is_visitante: 1, is_prestador: 0,
        bloqueado: 0, liberado: 0, data_entrada: null, data_saida: null, codigo_acesso: null,
        data_hora_inicio: null, data_hora_termino: null, user: null,
        auth_status: 'pendente', auth_solicitado_em: minutosAtras(1), auth_respondido_em: null,
        ...extra,
      };
      const rel = (v: any) => ({ ...v, pessoa, apartamento: { bloco: 'A', apto: '106' } });
      const g = gravacaoCondicional(visita, rel);
      const prisma: any = {
        isConnected: true,
        visitas: {
          update: jest.fn(async ({ data }: any) => rel(Object.assign(visita, data))),
          updateMany: jest.fn(g.updateMany),
          findUnique: jest.fn(g.findUnique),
        },
      };
      const card = cardFalso();
      const { svc, auditoria, realtime } = servico(prisma, card);
      const s = svc as any;
      const esperar = barreira(leituras);
      // Cada requisição lê a visita (cópia, como o banco devolveria) e espera
      // a outra ler também antes de seguir para a gravação.
      jest.spyOn(s, 'assertPodeAcessarVisita').mockImplementation(async () => {
        const lida = rel({ ...visita });
        await esperar();
        return lida;
      });
      const sync = jest.spyOn(s, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
      jest.spyOn(s, 'desativarOutrosCodigosVisita').mockResolvedValue(undefined);
      jest.spyOn(s, 'aptosDoMoradorMobile').mockResolvedValue(undefined);
      return { svc, prisma, visita, card, auditoria, realtime, sync };
    }

    it('P4: autorizar × negar simultâneos — só a primeira gravação vale, a outra recebe 400 sem efeitos', async () => {
      const { svc, visita, sync, auditoria, realtime, card } = montar();
      const [a, n] = await Promise.allSettled([svc.autorizar(1000004, morador), svc.negar(1000004, outroMorador)]);

      const ok = [a, n].filter((r) => r.status === 'fulfilled');
      const recusadas = [a, n].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(recusadas).toHaveLength(1);
      expect(recusadas[0].reason).toBeInstanceOf(BadRequestException);
      expect(recusadas[0].reason.message).toBe('Esta solicitação já foi respondida ou resolvida pela portaria.');
      // O estado final é o da resposta que venceu (a primeira a gravar), não um misto.
      const venceuAutorizar = a.status === 'fulfilled';
      expect(visita.auth_status).toBe(venceuAutorizar ? 'autorizado' : 'negado');
      expect(visita.liberado).toBe(venceuAutorizar ? 1 : 0);
      // Efeitos colaterais só uma vez (da que gravou).
      expect(sync).toHaveBeenCalledTimes(1);
      expect(auditoria.registrar).toHaveBeenCalledTimes(1);
      expect(realtime.emitToCondominio).toHaveBeenCalledTimes(1);
      await new Promise((r) => setImmediate(r));
      expect(card.respondido).toHaveBeenCalledTimes(1);
    });

    it('P4: negar × autorizar (ordem inversa) — o negado não vira liberado', async () => {
      const { svc, visita } = montar();
      const [n, a] = await Promise.allSettled([svc.negar(1000004, outroMorador), svc.autorizar(1000004, morador)]);
      expect(n.status).toBe('fulfilled');
      expect(a.status).toBe('rejected');
      expect(visita.auth_status).toBe('negado');
      expect(visita.liberado).toBe(0);
    });

    it('P4 variante: o morador nega entre a leitura e a gravação do check-in do console → 409, nada liberado', async () => {
      const { svc, visita, sync, auditoria } = montar();
      const [neg, entrada] = await Promise.allSettled([
        svc.negar(1000004, morador),
        svc.checkIn(1000004, porteiro, undefined, 'pendente'),
      ]);
      expect(neg.status).toBe('fulfilled');
      expect(entrada.status).toBe('rejected');
      expect((entrada as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      expect(visita.auth_status).toBe('negado');
      expect(visita.liberado).toBe(0);
      expect(visita.data_entrada).toBeNull();
      expect(sync).toHaveBeenCalledTimes(1); // só o do negar
      expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    });

    it('P4 variante: o morador nega entre a leitura e a gravação do Liberar do console → 409, nada liberado', async () => {
      const { svc, visita, sync } = montar();
      const [neg, liberar] = await Promise.allSettled([
        svc.negar(1000004, morador),
        svc.liberarAcesso(1000004, porteiro, undefined, 'pendente'),
      ]);
      expect(neg.status).toBe('fulfilled');
      expect((liberar as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      expect(visita.liberado).toBe(0);
      expect(visita.auth_status).toBe('negado');
      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('check-in que grava antes do negar: entra, e o negar atrasado é recusado (não tira o acesso)', async () => {
      const { svc, visita, prisma } = montar();
      // O negar só grava depois que o check-in gravou (a leitura dos dois foi antes).
      const gravar = prisma.visitas.updateMany.getMockImplementation();
      let checkInGravou!: () => void;
      const depoisDoCheckIn = new Promise<void>((r) => (checkInGravou = r));
      prisma.visitas.updateMany.mockImplementation(async (args: any) => {
        if (args.data.auth_status === 'negado') await depoisDoCheckIn;
        const r = await gravar!(args);
        if (args.data.auth_status !== 'negado') checkInGravou();
        return r;
      });
      const [entrada, neg] = await Promise.allSettled([
        svc.checkIn(1000004, porteiro, undefined, 'pendente'),
        svc.negar(1000004, morador),
      ]);
      expect(entrada.status).toBe('fulfilled');
      expect((neg as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
      expect(visita.liberado).toBe(1);
      expect(visita.auth_status).toBe('autorizado');
    });

    it('negativa conhecida pela portaria (esperado "negado") continua passando por cima', async () => {
      const { svc, visita } = montar({ auth_status: 'negado' }, 1);
      await svc.checkIn(1000004, porteiro, undefined, 'negado');
      expect(visita.liberado).toBe(1);
      expect(visita.auth_status).toBeNull();
    });
  });

  describe('legado (Visitantes)', () => {
    function montar(extra: Record<string, unknown> = {}, leituras = 2) {
      delete process.env['PESSOAS_MIGRATION_ENABLED'];
      const visitante: any = {
        id: 5, nome: 'QA_Legado', doc_identificacao: null, id_apartamento: 10, id_condominio: 1, bloqueado: 0,
        is_prestador: 0, liberado: 0, data_entrada: null, data_saida: null, foto_pessoa: null, user: null,
        auth_status: 'pendente', auth_solicitado_em: minutosAtras(1),
        ...extra,
      };
      const g = gravacaoCondicional(visitante);
      const prisma: any = {
        isConnected: true,
        visitantes: {
          update: jest.fn(async ({ data }: any) => Object.assign(visitante, data)),
          updateMany: jest.fn(g.updateMany),
          findUnique: jest.fn(g.findUnique),
        },
        apartamentos: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, id_condominio: 1 })) },
      };
      const card = cardFalso();
      const { svc, auditoria } = servico(prisma, card);
      const s = svc as any;
      const esperar = barreira(leituras);
      jest.spyOn(s, 'assertPodeAcessarVisitante').mockImplementation(async () => {
        const lida = { ...visitante };
        await esperar();
        return lida;
      });
      const sync = jest.spyOn(s, 'fireFacialSync').mockImplementation(() => undefined);
      jest.spyOn(s, 'carregarContextoVisitante').mockResolvedValue(null);
      jest.spyOn(s, 'desativarOutrosCodigos').mockResolvedValue(undefined);
      jest.spyOn(s, 'aptosDoMoradorMobile').mockResolvedValue(undefined);
      jest.spyOn(s, 'notificarMoradoresAutorizacao').mockResolvedValue(1);
      jest.spyOn(s, 'assertPodeUsarApartamento').mockResolvedValue(undefined);
      return { svc, prisma, visitante, sync, auditoria };
    }

    it('P4: autorizar × negar simultâneos — uma vale, a outra 400 sem efeitos', async () => {
      const { svc, visitante, sync, auditoria } = montar();
      const [a, n] = await Promise.allSettled([svc.autorizar(5, morador), svc.negar(5, outroMorador)]);
      expect([a, n].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const recusada = [a, n].find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(recusada.reason).toBeInstanceOf(BadRequestException);
      expect(visitante.auth_status).toBe(a.status === 'fulfilled' ? 'autorizado' : 'negado');
      expect(sync).toHaveBeenCalledTimes(1);
      expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    });

    it('P4 variante: negar entre a leitura e a gravação do check-in → 409, nada liberado', async () => {
      const { svc, visitante } = montar();
      const [neg, entrada] = await Promise.allSettled([svc.negar(5, morador), svc.checkIn(5, porteiro, undefined, 'pendente')]);
      expect(neg.status).toBe('fulfilled');
      expect((entrada as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      expect(visitante.liberado).toBe(0);
      expect(visitante.data_entrada).toBeNull();
    });

    it('P4 variante: negar entre a leitura e a gravação do Liberar → 409, nada liberado', async () => {
      const { svc, visitante } = montar();
      const [neg, liberar] = await Promise.allSettled([
        svc.negar(5, morador),
        svc.liberarAcesso(5, porteiro, undefined, 'pendente'),
      ]);
      expect(neg.status).toBe('fulfilled');
      expect((liberar as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      expect(visitante.liberado).toBe(0);
    });

    const entrou = minutosAtras(30);
    it.each([['liberarAcesso'], ['solicitarAutorizacao']])(
      'P3: %s com a pessoa dentro é recusado e a entrada fica',
      async (acao) => {
        const { svc, prisma, visitante } = montar(
          { auth_status: null, auth_solicitado_em: null, liberado: 1, data_entrada: entrou },
          1,
        );
        await expect((svc as any)[acao](5, porteiro)).rejects.toThrow('Este visitante já está no condomínio');
        expect(visitante.data_entrada).toEqual(entrou);
        expect(prisma.visitantes.update).not.toHaveBeenCalled();
        expect(prisma.visitantes.updateMany).not.toHaveBeenCalled();
      },
    );

    it.each([['liberarAcesso'], ['solicitarAutorizacao']])(
      'P3: %s depois da baixa (entrou e saiu) segue normal',
      async (acao) => {
        const { svc, visitante } = montar(
          { auth_status: null, auth_solicitado_em: null, liberado: 0, data_entrada: entrou, data_saida: minutosAtras(5) },
          1,
        );
        await (svc as any)[acao](5, porteiro);
        expect(visitante.data_entrada).toBeNull();
      },
    );
  });

  describe('K1 — redirecionar o pedido para outra unidade (Pessoas/Visitas)', () => {
    function montar(principalExtra: Record<string, unknown> = {}, outraUnidade: Record<string, unknown> | null = {}) {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const pessoa = { id: 2000001, nome: 'QA_K1', bloqueado: 0, foto_pessoa: null };
      const visitas = new Map<number, any>();
      const base = {
        id_pessoa: 2000001, id_condominio: 1, is_visitante: 1, is_prestador: 0, bloqueado: 0, liberado: 0,
        data_entrada: null, data_saida: null, codigo_acesso: null, data_hora_inicio: null, data_hora_termino: null,
        user: null, avisar: 1, tag_rfid: null, dias_semana: null, categorias: null,
        auth_status: null, auth_solicitado_em: null, auth_respondido_em: null, created_at: minutosAtras(60),
      };
      visitas.set(1000004, {
        ...base, id: 1000004, id_apartamento: 101,
        auth_status: 'pendente', auth_solicitado_em: minutosAtras(1), ...principalExtra,
      });
      if (outraUnidade) visitas.set(1000020, { ...base, id: 1000020, id_apartamento: 102, ...outraUnidade });
      let seq = 1000100;
      const rel = (v: any) => ({ ...v, pessoa, apartamento: { bloco: 'A', apto: String(v.id_apartamento) } });
      const g = gravacaoCondicionalMapa(visitas, rel);
      const prisma: any = {
        isConnected: true,
        apartamentos: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, id_condominio: 1 })) },
        visitas: {
          findFirst: jest.fn(async ({ where }: any) => {
            const achada = [...visitas.values()].find(
              (v) => v.id_pessoa === where.id_pessoa && v.id_apartamento === where.id_apartamento,
            );
            return achada ? rel(achada) : null;
          }),
          create: jest.fn(async ({ data }: any) => {
            const nova = { id: seq++, created_at: new Date(), ...data };
            visitas.set(nova.id, nova);
            return rel(nova);
          }),
          update: jest.fn(async ({ where, data }: any) => rel(Object.assign(visitas.get(where.id), data))),
          updateMany: jest.fn(g.updateMany),
          findUnique: jest.fn(g.findUnique),
        },
        vagas: { findFirst: jest.fn(async () => null) },
      };
      const card = cardFalso();
      const { svc } = servico(prisma, card);
      const s = svc as any;
      jest.spyOn(s, 'assertPodeAcessarVisita').mockImplementation(async (id: any) => rel({ ...visitas.get(Number(id)) }));
      jest.spyOn(s, 'assertPodeUsarApartamento').mockResolvedValue(undefined);
      jest.spyOn(s, 'notificarMoradoresAutorizacao').mockResolvedValue(1);
      jest.spyOn(s, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
      return { svc, prisma, visitas, card };
    }

    const esperarCard = () => new Promise((r) => setImmediate(r));

    it('o pedido do 101 deixa de ser respondível e o card dele é encerrado; o 101 não autoriza mais', async () => {
      const { svc, visitas, card } = montar();
      await svc.solicitarAutorizacao(1000004, porteiro, 102);
      await esperarCard();

      expect(visitas.get(1000020).auth_status).toBe('pendente');
      const original = visitas.get(1000004);
      expect(original.auth_status).toBeNull();
      expect(original.auth_solicitado_em).toBeNull();
      expect(card.encerrar).toHaveBeenCalledWith('visita', 1000004);

      // O morador do 101 toca AUTORIZAR no card que ainda estava no celular.
      await expect(svc.autorizar(1000004, morador)).rejects.toThrow(
        'Esta solicitação já foi respondida ou resolvida pela portaria.',
      );
      expect(visitas.get(1000004).liberado).toBe(0);
    });

    it('sem visita na unidade nova (cria uma lá): o pedido do 101 também é cancelado', async () => {
      const { svc, visitas, card } = montar({}, null);
      await svc.solicitarAutorizacao(1000004, porteiro, 102);
      await esperarCard();
      expect(visitas.get(1000004).auth_status).toBeNull();
      expect(card.encerrar).toHaveBeenCalledWith('visita', 1000004);
    });

    it('a visita do 101 sem pedido pendente não é tocada nem tem card encerrado', async () => {
      const respondido = minutosAtras(30);
      const { svc, visitas, card } = montar({ auth_status: 'negado', auth_respondido_em: respondido });
      await svc.solicitarAutorizacao(1000004, porteiro, 102);
      await esperarCard();
      expect(visitas.get(1000004).auth_status).toBe('negado');
      expect(card.encerrar).not.toHaveBeenCalled();
    });

    it('pedido na mesma unidade não cancela nada', async () => {
      const { svc, visitas, card, prisma } = montar({ auth_status: null, auth_solicitado_em: null });
      await svc.solicitarAutorizacao(1000004, porteiro, 101);
      await esperarCard();
      expect(visitas.get(1000004).auth_status).toBe('pendente');
      expect(prisma.visitas.updateMany).not.toHaveBeenCalled();
      expect(card.encerrar).not.toHaveBeenCalled();
    });
  });

  describe('P1 resto — o legado mostra a negativa recente na lista', () => {
    function listar(registros: Record<string, unknown>[]) {
      delete process.env['PESSOAS_MIGRATION_ENABLED'];
      const agora = Date.now();
      const linhas = registros.map((r, i) => ({
        id: 5 + i, nome: 'QA_Negado', doc_identificacao: '52998224725', foto_pessoa: null, foto_documento: null,
        face_id: null, face_sync_status: null, tag_rfid: null, is_visitante: 1, is_prestador: 0, id_condominio: 1,
        id_apartamento: 10, liberado: 0, bloqueado: 0, codigo_acesso: null, data_entrada: null, data_saida: null,
        data_hora_inicio: null, data_hora_termino: null, dias_semana: null, categorias: null,
        auth_status: null, auth_solicitado_em: null, auth_respondido_em: null,
        created_at: new Date(agora - (i + 1) * 60 * 60_000), apartamento: { id: 10, bloco: 'A', apto: '10' },
        ...r,
      }));
      const prisma: any = {
        isConnected: true,
        visitantes: { findMany: jest.fn(async () => linhas) },
        vagas: { findMany: jest.fn(async () => []) },
      };
      return servico(prisma).svc.listarPessoas(1);
    }

    it('negado pelo morador, sem liberação depois: a pessoa e a unidade mostram "negado"', async () => {
      const respondido = minutosAtras(2);
      const [p]: any[] = await listar([
        { auth_status: 'negado', auth_solicitado_em: minutosAtras(3), auth_respondido_em: respondido },
      ]);
      expect(p.apartamentosVisitados[0].auth_status).toBe('negado');
      expect(p.auth_status).toBe('negado');
      expect(p.auth_respondido_em).toBe(respondido.toISOString());
    });

    it('negado e depois liberado (liberado=1): não mostra a negativa', async () => {
      const [p]: any[] = await listar([{ auth_status: 'negado', liberado: 1, auth_respondido_em: minutosAtras(2) }]);
      expect(p.auth_status).toBeNull();
    });

    it('pedido pendente vale mais que a negativa antiga', async () => {
      const [p]: any[] = await listar([{ auth_status: 'pendente', auth_solicitado_em: minutosAtras(1) }]);
      expect(p.auth_status).toBe('pendente');
    });
  });
});

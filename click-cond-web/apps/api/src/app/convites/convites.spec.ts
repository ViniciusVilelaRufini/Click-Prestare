import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConvitesService, MAX_CONVITES_ATIVOS } from './convites.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Convite de visita por link — a primeira superfície do sistema em que alguém
 * SEM CONTA grava dado.
 *
 * O que estes testes protegem, em ordem de gravidade:
 *
 *  1. Token inexistente, expirado e já usado respondem IGUAL. Respostas
 *     diferentes viram um oráculo que confirma quais tokens existem.
 *  2. O convite nunca escreve em `Visitantes`; só a confirmação escreve, e
 *     pelo `create()` — que é quem herda foto e face_id de um CPF conhecido.
 *  3. Um morador não decide o convite de outro.
 *  4. Recusa apaga a foto na hora.
 */
describe('ConvitesService', () => {
  const MORADOR: JwtPayload = { sub: 7, nome: 'Morador', typeAccess: 'Morador' };
  const OUTRO: JwtPayload = { sub: 99, nome: 'Vizinho', typeAccess: 'Morador' };

  const hash = (t: string) => createHash('sha256').update(t).digest('hex');

  function build(overrides: { convite?: any; ativos?: number; vinculo?: any } = {}) {
    const convites: any[] = overrides.convite ? [overrides.convite] : [];

    const prisma: any = {
      isConnected: true,
      apartamentos_Users: {
        findFirst: jest.fn(async () =>
          'vinculo' in overrides
            ? overrides.vinculo
            // Nomes REAIS das colunas de Apartamentos_Users. A versão
            // anterior deste mock dizia `id_apartamento`, repetindo o
            // engano do service: o teste passava e a produção dava 500.
            : { id_apto: 5, apartamento: { id_condominio: 2 } },
        ),
      },
      users: { findUnique: jest.fn(async () => ({ fcm_token: 'fcm-abc' })) },
      convites_Visita: {
        count: jest.fn(async () => overrides.ativos ?? 0),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        findUnique: jest.fn(async ({ where }: any) =>
          convites.find(
            (c) => c.id === where.id || c.token_hash === where.token_hash,
          ) ?? null,
        ),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const c = convites.find((x) => x.id === where.id && x.status === where.status);
          if (!c) return { count: 0 };
          Object.assign(c, data);
          return { count: 1 };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const c = convites.find((x) => x.id === where.id);
          Object.assign(c, data);
          return c;
        }),
        findMany: jest.fn(async () => convites.filter((c) => c.status === 'preenchido')),
      },
    };

    const storage: any = { enabled: true, uploadDataUrl: jest.fn(async () => 'https://cdn/foto.jpg'), deleteUrl: jest.fn(async () => undefined) };
    const notifications: any = { sendPushNotification: jest.fn(async () => true) };
    const visitantes: any = { create: jest.fn(async () => ({ id: 500 })) };

    const svc = new ConvitesService(prisma, storage, notifications, visitantes);
    return { svc, prisma, storage, notifications, visitantes, convites };
  }

  const conviteAberto = (extra: any = {}) => ({
    id: 1,
    token_hash: hash('tok'),
    id_condominio: 2,
    id_apartamento: 5,
    id_usuario: 7,
    is_prestador: 0,
    status: 'aguardando',
    expira_em: new Date(Date.now() + 3600_000),
    condominio: { nome: 'Edifício Demo' },
    apartamento: { apto: '101', bloco: 'A' },
    ...extra,
  });

  const payloadValido = {
    nome: 'Rodrigo Rufini',
    cpf: '390.533.447-05', // CPF válido de teste
    foto: 'data:image/png;base64,AAAA',
    aceite: true,
  };

  describe('validação de CPF', () => {
    it('aceita CPF válido com ou sem máscara', () => {
      expect(ConvitesService.cpfValido('390.533.447-05')).toBe(true);
      expect(ConvitesService.cpfValido('39053344705')).toBe(true);
    });

    it('recusa dígito verificador errado', () => {
      // Um dígito trocado criaria uma "pessoa" nova no agrupamento por CPF:
      // o visitante recorrente vira dois cadastros, e dois rostos no terminal.
      expect(ConvitesService.cpfValido('39053344704')).toBe(false);
    });

    it('recusa sequência repetida e tamanho errado', () => {
      expect(ConvitesService.cpfValido('11111111111')).toBe(false);
      expect(ConvitesService.cpfValido('123')).toBe(false);
    });

    it('normaliza para só dígitos', () => {
      expect(ConvitesService.normalizarCpf('390.533.447-05')).toBe('39053344705');
    });
  });

  describe('geração pelo morador', () => {
    it('tira condomínio e apartamento do vínculo, não do cliente', async () => {
      const { svc, prisma } = build();
      await svc.gerar(MORADOR, false);

      const data = prisma.convites_Visita.create.mock.calls[0][0].data;
      expect(data.id_condominio).toBe(2);
      expect(data.id_apartamento).toBe(5);
      expect(data.id_usuario).toBe(7);
    });

    it('grava o HASH do token, nunca o token', async () => {
      const { svc, prisma } = build();
      const { token } = await svc.gerar(MORADOR, false);

      const data = prisma.convites_Visita.create.mock.calls[0][0].data;
      expect(data.token_hash).toBe(hash(token));
      expect(data.token_hash).not.toBe(token);
    });

    it('recusa quem não tem unidade vinculada', async () => {
      const { svc } = build({ vinculo: null });
      await expect(svc.gerar(MORADOR, false)).rejects.toThrow(ForbiddenException);
    });

    it('barra no teto de convites ativos', async () => {
      const { svc } = build({ ativos: MAX_CONVITES_ATIVOS });
      await expect(svc.gerar(MORADOR, false)).rejects.toThrow(BadRequestException);
    });
  });

  describe('leitura pública', () => {
    it('token inexistente, expirado e já usado dão a MESMA resposta', async () => {
      const inexistente = build();
      const expirado = build({
        convite: conviteAberto({ expira_em: new Date(Date.now() - 1000) }),
      });
      const usado = build({ convite: conviteAberto({ status: 'preenchido' }) });

      const erros: string[] = [];
      for (const ctx of [inexistente, expirado, usado]) {
        await ctx.svc.lerPublico('tok').catch((e) => erros.push(e.message));
      }

      expect(erros).toHaveLength(3);
      expect(new Set(erros).size).toBe(1);
    });

    it('não revela o morador', async () => {
      const { svc } = build({ convite: conviteAberto() });
      const dados = await svc.lerPublico('tok');

      expect(JSON.stringify(dados)).not.toMatch(/id_usuario|morador/i);
      expect(dados.unidade).toContain('101');
    });
  });

  describe('preenchimento pelo visitante', () => {
    it('grava e avisa o morador', async () => {
      const { svc, convites, notifications } = build({ convite: conviteAberto() });
      await svc.responder('tok', payloadValido);

      expect(convites[0].status).toBe('preenchido');
      expect(convites[0].cpf).toBe('39053344705');
      expect(convites[0].aceite_em).toBeInstanceOf(Date);
      expect(notifications.sendPushNotification).toHaveBeenCalled();
    });

    it('manda o push com o TOKEN FCM, não com o id do morador', async () => {
      const { svc, notifications } = build({ convite: conviteAberto() });
      await svc.responder('tok', payloadValido);

      // `sendPushNotification` recebe o token do aparelho. Passar o id do
      // usuário compila (o build da API é transpile-only) e o push nunca
      // chega — falha silenciosa. Quem pegou foi `nx typecheck api`.
      expect(notifications.sendPushNotification).toHaveBeenCalledWith(
        'fcm-abc',
        expect.any(String),
        expect.any(String),
        expect.anything(),
      );
    });

    it('morador sem fcm_token não quebra o preenchimento', async () => {
      const { svc, prisma, convites, notifications } = build({ convite: conviteAberto() });
      prisma.users.findUnique.mockResolvedValueOnce({ fcm_token: null });

      await expect(svc.responder('tok', payloadValido)).resolves.toEqual({ ok: true });
      expect(notifications.sendPushNotification).not.toHaveBeenCalled();
      expect(convites[0].status).toBe('preenchido');
    });

    it('recusa sem aceite', async () => {
      const { svc, convites } = build({ convite: conviteAberto() });
      await expect(
        svc.responder('tok', { ...payloadValido, aceite: false }),
      ).rejects.toThrow(BadRequestException);
      expect(convites[0].status).toBe('aguardando');
    });

    it('recusa CPF inválido e foto ausente', async () => {
      const a = build({ convite: conviteAberto() });
      await expect(a.svc.responder('tok', { ...payloadValido, cpf: '11111111111' }))
        .rejects.toThrow(BadRequestException);

      const b = build({ convite: conviteAberto() });
      await expect(b.svc.responder('tok', { ...payloadValido, foto: '' }))
        .rejects.toThrow(BadRequestException);
    });

    it('o segundo envio do mesmo link falha — uso único', async () => {
      const { svc } = build({ convite: conviteAberto() });
      await svc.responder('tok', payloadValido);
      await expect(svc.responder('tok', payloadValido)).rejects.toThrow(NotFoundException);
    });

    it('push que falha não desfaz o preenchimento', async () => {
      const { svc, convites, notifications } = build({ convite: conviteAberto() });
      notifications.sendPushNotification.mockRejectedValueOnce(new Error('FCM fora'));

      await expect(svc.responder('tok', payloadValido)).resolves.toEqual({ ok: true });
      expect(convites[0].status).toBe('preenchido');
    });
  });

  describe('decisão do morador', () => {
    const preenchido = (extra: any = {}) =>
      conviteAberto({
        status: 'preenchido',
        nome: 'Rodrigo',
        cpf: '39053344705',
        foto_url: 'https://cdn/foto.jpg',
        ...extra,
      });

    it('confirmar cria o visitante PELO create() existente', async () => {
      const { svc, visitantes, convites } = build({ convite: preenchido() });
      await svc.confirmar(1, MORADOR);

      // É o create() que herda foto_pessoa e face_id de um CPF já conhecido.
      // Escrever direto na tabela criaria rosto duplicado no terminal facial.
      expect(visitantes.create).toHaveBeenCalledTimes(1);
      const dto = visitantes.create.mock.calls[0][0];
      expect(dto.doc_identificacao).toBe('39053344705');
      expect(dto.id_condominio).toBe(2);
      expect(convites[0].status).toBe('confirmado');
      expect(convites[0].id_visitante).toBe(500);
    });

    it('prestador entra com is_prestador, não como visitante', async () => {
      const { svc, visitantes } = build({ convite: preenchido({ is_prestador: 1 }) });
      await svc.confirmar(1, MORADOR);

      const dto = visitantes.create.mock.calls[0][0];
      expect(dto.is_prestador).toBe(1);
      expect(dto.is_visitante).toBe(0);
    });

    it('repassa período e dias ao create()', async () => {
      const { svc, visitantes } = build({ convite: preenchido({ is_prestador: 1 }) });
      await svc.confirmar(1, MORADOR, {
        data_hora_inicio: '2026-09-12T08:00:00',
        data_hora_termino: '2026-09-12T18:00:00',
        dias_semana: '1,2,3',
      });

      const dto = visitantes.create.mock.calls[0][0];
      expect(dto.data_hora_inicio).toBe('2026-09-12T08:00:00');
      expect(dto.data_hora_termino).toBe('2026-09-12T18:00:00');
      expect(dto.dias_semana).toBe('1,2,3');
    });

    it('ignora dias_semana quando não é prestador', async () => {
      const { svc, visitantes } = build({ convite: preenchido() });
      await svc.confirmar(1, MORADOR, { dias_semana: '1,2,3' });

      expect(visitantes.create.mock.calls[0][0].dias_semana).toBeUndefined();
    });

    it('confirmar sem corpo continua funcionando', async () => {
      // A versão do app já publicada manda corpo vazio. Se a API passasse a
      // exigir os campos, quem não atualizou perderia a confirmação.
      const { svc, visitantes, convites } = build({ convite: preenchido() });
      await svc.confirmar(1, MORADOR);

      expect(visitantes.create).toHaveBeenCalledTimes(1);
      expect(convites[0].status).toBe('confirmado');
    });

    it('recusa saída antes da entrada', async () => {
      // Autorização que nasce vencida: o visitante chega, o acesso é negado e
      // ninguém entende por quê.
      const { svc, visitantes } = build({ convite: preenchido() });
      await expect(
        svc.confirmar(1, MORADOR, {
          data_hora_inicio: '2026-09-12T18:00:00',
          data_hora_termino: '2026-09-12T08:00:00',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(visitantes.create).not.toHaveBeenCalled();
    });

    it('morador não decide convite de outro morador', async () => {
      const { svc, visitantes } = build({ convite: preenchido() });
      await expect(svc.confirmar(1, OUTRO)).rejects.toThrow(NotFoundException);
      expect(visitantes.create).not.toHaveBeenCalled();
    });

    it('recusar apaga a foto na hora', async () => {
      const { svc, storage, convites } = build({ convite: preenchido() });
      await svc.recusar(1, MORADOR);

      // Dado de quem não foi autorizado não fica esperando job de limpeza.
      expect(storage.deleteUrl).toHaveBeenCalledWith('https://cdn/foto.jpg');
      expect(convites[0].status).toBe('recusado');
      expect(convites[0].foto_url).toBeNull();
    });

    it('não confirma convite que ainda não foi preenchido', async () => {
      const { svc, visitantes } = build({ convite: conviteAberto() });
      await expect(svc.confirmar(1, MORADOR)).rejects.toThrow(BadRequestException);
      expect(visitantes.create).not.toHaveBeenCalled();
    });
  });
});

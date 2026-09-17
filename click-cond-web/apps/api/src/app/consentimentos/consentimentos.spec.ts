import { ConsentimentosService, POLITICA_VERSAO } from './consentimentos.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Consentimento LGPD.
 *
 * O que estes testes protegem:
 *
 *  1. A tabela é APPEND-ONLY. Revogar não pode apagar o aceite anterior — o
 *     histórico é o que sustenta juridicamente o tratamento (Art. 8º, §5º).
 *  2. Só o aceite de privacidade bloqueia. A biometria é opcional porque o
 *     Art. 8º, §3º exige consentimento LIVRE: se recusá-la travasse o app,
 *     seria condição de uso, não consentimento.
 *  3. Mudança de versão do texto faz pedir de novo. Sem isso, "aceitei" é uma
 *     afirmação sobre um texto que ninguém sabe mais qual era.
 *  4. Ausência de registro conta como NÃO autorizado.
 */
describe('ConsentimentosService', () => {
  const USER: JwtPayload = { sub: 7, nome: 'Morador', typeAccess: 'Morador' };

  function build(linhas: any[] = [], moradores: any[] = [], unsyncResult = true) {
    const registros = [...linhas];
    const listaMoradores = [...moradores];
    const prisma: any = {
      isConnected: true,
      consentimentos: {
        findFirst: jest.fn(async ({ where }: any) => {
          const doTipo = registros
            .filter((r) => r.id_user === where.id_user && r.tipo === where.tipo)
            .sort((a, b) => b.registrado_em - a.registrado_em);
          return doTipo[0] ?? null;
        }),
        create: jest.fn(async ({ data }: any) => {
          registros.push(data);
          return data;
        }),
        createMany: jest.fn(async ({ data }: any) => {
          registros.push(...data);
          return { count: data.length };
        }),
      },
      moradores: {
        findMany: jest.fn(async ({ where }: any) => {
          return listaMoradores.filter((m) => m.id_user === where.id_user);
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const m = listaMoradores.find((x) => x.id === where.id);
          if (m) Object.assign(m, data);
          return m;
        }),
      },
    };
    const facial: any = {
      unsyncMorador: jest.fn().mockResolvedValue(unsyncResult),
    };
    return { svc: new ConsentimentosService(prisma, facial), prisma, registros, facial, listaMoradores };
  }

  const linha = (
    tipo: string,
    aceito: number,
    versao = POLITICA_VERSAO,
    quando = new Date(Date.now() - 5000),
  ) => ({
    id_user: 7,
    tipo,
    aceito,
    versao,
    registrado_em: quando,
  });

  describe('pendentes', () => {
    it('quem nunca aceitou precisa aceitar', async () => {
      const { svc } = build();
      const r = await svc.pendentes(USER);
      expect(r.precisaAceitar).toBe(true);
    });

    it('quem aceitou a versão vigente não precisa', async () => {
      const { svc } = build([linha('privacidade', 1)]);
      const r = await svc.pendentes(USER);
      expect(r.precisaAceitar).toBe(false);
    });

    it('quem aceitou versão ANTERIOR precisa de novo', async () => {
      const { svc } = build([linha('privacidade', 1, '2020-01')]);
      const r = await svc.pendentes(USER);
      expect(r.precisaAceitar).toBe(true);
    });

    it('quem recusou precisa aceitar', async () => {
      const { svc } = build([linha('privacidade', 0)]);
      const r = await svc.pendentes(USER);
      expect(r.precisaAceitar).toBe(true);
    });

    it('recusar biometria NÃO bloqueia o app', async () => {
      // Art. 8º, §3º: consentimento tem de ser livre. Biometria travando o
      // app seria condição de uso.
      const { svc } = build([linha('privacidade', 1), linha('biometria', 0)]);
      const r = await svc.pendentes(USER);

      expect(r.precisaAceitar).toBe(false);
      expect(r.biometria.aceita).toBe(false);
      expect(r.biometria.respondida).toBe(true);
    });
  });

  describe('registrar', () => {
    it('grava as duas respostas, inclusive a recusa', async () => {
      const { svc, registros } = build();
      await svc.registrar(USER, { privacidade: true, biometria: false });

      expect(registros).toHaveLength(2);
      expect(registros.find((r) => r.tipo === 'privacidade').aceito).toBe(1);
      // A recusa é fato a registrar, não ausência de registro.
      expect(registros.find((r) => r.tipo === 'biometria').aceito).toBe(0);
      expect(registros.every((r) => r.versao === POLITICA_VERSAO)).toBe(true);
    });

    it('revogar não apaga o aceite anterior — append-only', async () => {
      const ontem = new Date(Date.now() - 86400_000);
      const { svc, registros, prisma } = build([linha('biometria', 1, POLITICA_VERSAO, ontem)]);

      await svc.registrar(USER, { privacidade: true, biometria: false });

      // O histórico é a prova: precisa mostrar que aceitou e depois revogou.
      expect(registros.filter((r) => r.tipo === 'biometria')).toHaveLength(2);
      expect(prisma.consentimentos.createMany).toHaveBeenCalled();
      // Nenhum update em lugar nenhum.
      expect(prisma.consentimentos.update).toBeUndefined();
    });
  });

  describe('autorizouBiometria — a trava que faz a caixa valer', () => {
    it('sem registro nenhum, NÃO autoriza', async () => {
      // Ausência de consentimento não é consentimento.
      const { svc } = build();
      expect(await svc.autorizouBiometria(7)).toBe(false);
    });

    it('autoriza quem aceitou', async () => {
      const { svc } = build([linha('biometria', 1)]);
      expect(await svc.autorizouBiometria(7)).toBe(true);
    });

    it('não autoriza quem recusou', async () => {
      const { svc } = build([linha('biometria', 0)]);
      expect(await svc.autorizouBiometria(7)).toBe(false);
    });

    it('vale a resposta MAIS RECENTE', async () => {
      const ontem = new Date(Date.now() - 86400_000);
      const { svc } = build([
        linha('biometria', 1, POLITICA_VERSAO, ontem),
        linha('biometria', 0, POLITICA_VERSAO, new Date()),
      ]);
      expect(await svc.autorizouBiometria(7)).toBe(false);
    });

    it('aceite de versão anterior continua valendo', async () => {
      // Revogar exige ato do titular, não passagem do tempo. Mudar o texto
      // faz perguntar de novo, mas não revoga sozinho.
      const { svc } = build([linha('biometria', 1, '2020-01')]);
      expect(await svc.autorizouBiometria(7)).toBe(true);
    });

    it('sem usuário, não autoriza', async () => {
      const { svc } = build([linha('biometria', 1)]);
      expect(await svc.autorizouBiometria(0)).toBe(false);
    });
  });

  describe('revogarBiometria', () => {
    const criarMorador = () => ({
      id: 1,
      id_user: 7,
      id_condominio: 10,
      face_id: 'face-123',
      face_sync_status: 'synced',
    });

    it('grava nova linha com aceito=0 (append-only) e remove rosto do aparelho', async () => {
      const { svc, registros, facial, listaMoradores } = build(
        [linha('biometria', 1)],
        [criarMorador()],
        true,
      );

      const r = await svc.revogarBiometria(USER);
      expect(r.ok).toBe(true);
      expect(r.status).toBe('revoked');

      // Append-only: mantém histórico e adiciona linha nova
      expect(registros).toHaveLength(2);
      expect(registros[1]).toMatchObject({
        id_user: 7,
        tipo: 'biometria',
        aceito: 0,
      });

      // Chamou unsyncMorador nos aparelhos
      expect(facial.unsyncMorador).toHaveBeenCalledWith(1, 'face-123', 10);
      expect(listaMoradores[0].face_id).toBeNull();
      expect(listaMoradores[0].face_sync_status).toBe('revoked');

      // Imediatamente não autoriza mais
      expect(await svc.autorizouBiometria(7)).toBe(false);
    });

    it('se aparelho estiver offline, marca pending_removal para retry sem perder revogação', async () => {
      const { svc, listaMoradores } = build(
        [linha('biometria', 1)],
        [criarMorador()],
        false, // falha / offline
      );

      const r = await svc.revogarBiometria(USER);
      expect(r.ok).toBe(true);
      expect(r.status).toBe('pending_removal');
      expect(listaMoradores[0].face_sync_status).toBe('pending_removal');
      expect(await svc.autorizouBiometria(7)).toBe(false);
    });
  });
});

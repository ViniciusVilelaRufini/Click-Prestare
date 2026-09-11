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

  function build(linhas: any[] = []) {
    const registros = [...linhas];
    const prisma: any = {
      isConnected: true,
      consentimentos: {
        findFirst: jest.fn(async ({ where }: any) => {
          const doTipo = registros
            .filter((r) => r.id_user === where.id_user && r.tipo === where.tipo)
            .sort((a, b) => b.registrado_em - a.registrado_em);
          return doTipo[0] ?? null;
        }),
        createMany: jest.fn(async ({ data }: any) => {
          registros.push(...data);
          return { count: data.length };
        }),
      },
    };
    return { svc: new ConsentimentosService(prisma), prisma, registros };
  }

  const linha = (tipo: string, aceito: number, versao = POLITICA_VERSAO, quando = new Date()) => ({
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
});

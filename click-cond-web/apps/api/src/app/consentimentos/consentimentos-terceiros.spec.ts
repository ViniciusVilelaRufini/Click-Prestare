import { ConsentimentosTerceirosService } from './consentimentos-terceiros.service';
import { POLITICA_VERSAO } from './consentimentos.service';

/**
 * Consentimento biométrico de quem não tem conta: visitante e prestador.
 *
 * O que estes testes protegem:
 *
 *  1. Ausência de declaração NÃO autoriza. É o inverso do que o código fazia
 *     antes: quem tinha foto ia para o terminal, ponto.
 *  2. Autorizar a biometria e declarar maioridade são coisas SEPARADAS. As
 *     duas precisam estar presentes — o contrato veda biometria de menor
 *     ainda que alguém autorize.
 *  3. A busca é pelo DOCUMENTO, não pelo id do registro. `Visitantes` tem uma
 *     linha por visita; o mesmo CPF voltando não declara tudo de novo.
 *  4. Append-only, como `Consentimentos`: revogar é linha nova.
 */
describe('ConsentimentosTerceirosService', () => {
  function build(linhas: any[] = []) {
    const registros = [...linhas];
    const prisma: any = {
      isConnected: true,
      consentimentos_Terceiros: {
        findFirst: jest.fn(async ({ where }: any) => {
          const casa = (r: any) => {
            if (r.id_condominio !== where.id_condominio) return false;
            if (where.doc !== undefined) return r.doc === where.doc;
            return r.tipo_pessoa === where.tipo_pessoa && r.id_pessoa === where.id_pessoa;
          };
          return (
            registros
              .filter(casa)
              .sort((a, b) => b.registrado_em - a.registrado_em)[0] ?? null
          );
        }),
        create: jest.fn(async ({ data }: any) => {
          registros.push(data);
          return data;
        }),
      },
    };
    return { svc: new ConsentimentosTerceirosService(prisma), prisma, registros };
  }

  const linha = (over: any = {}) => ({
    id_condominio: 1,
    tipo_pessoa: 'visitante',
    id_pessoa: 10,
    doc: '12345678900',
    versao: POLITICA_VERSAO,
    aceito: 1,
    maior_idade: 1,
    registrado_em: new Date(),
    ...over,
  });

  const alvo = (over: any = {}) => ({
    idCondominio: 1,
    tipoPessoa: 'visitante' as const,
    idPessoa: 10,
    doc: '123.456.789-00',
    ...over,
  });

  describe('autorizouBiometria', () => {
    it('sem declaração nenhuma, NÃO autoriza', async () => {
      const { svc } = build();
      expect(await svc.autorizouBiometria(alvo())).toBe(false);
    });

    it('autoriza com biometria aceita e maioridade declarada', async () => {
      const { svc } = build([linha()]);
      expect(await svc.autorizouBiometria(alvo())).toBe(true);
    });

    it('NÃO autoriza quando falta a declaração de maioridade', async () => {
      // O contrato veda biometria de menor de 18 ainda que alguém autorize.
      const { svc } = build([linha({ maior_idade: 0 })]);
      expect(await svc.autorizouBiometria(alvo())).toBe(false);
    });

    it('NÃO autoriza quando a biometria foi recusada', async () => {
      const { svc } = build([linha({ aceito: 0 })]);
      expect(await svc.autorizouBiometria(alvo())).toBe(false);
    });

    it('acha pelo documento, mesmo sendo outro registro de visita', async () => {
      // A pessoa é a mesma; o id muda a cada visita.
      const { svc } = build([linha({ id_pessoa: 999 })]);
      expect(await svc.autorizouBiometria(alvo({ idPessoa: 10 }))).toBe(true);
    });

    it('normaliza o documento antes de buscar', async () => {
      const { svc } = build([linha({ doc: '12345678900' })]);
      expect(await svc.autorizouBiometria(alvo({ doc: '123.456.789-00' }))).toBe(true);
    });

    it('sem documento, cai na busca por tipo + id do registro', async () => {
      const { svc } = build([linha({ doc: null })]);
      expect(await svc.autorizouBiometria(alvo({ doc: null }))).toBe(true);
    });

    it('declaração de outro condomínio não vale', async () => {
      const { svc } = build([linha({ id_condominio: 2 })]);
      expect(await svc.autorizouBiometria(alvo({ idCondominio: 1 }))).toBe(false);
    });

    it('vale a declaração MAIS RECENTE', async () => {
      const ontem = new Date(Date.now() - 86400_000);
      const { svc } = build([
        linha({ aceito: 1, registrado_em: ontem }),
        linha({ aceito: 0, registrado_em: new Date() }),
      ]);
      expect(await svc.autorizouBiometria(alvo())).toBe(false);
    });
  });

  describe('registrar', () => {
    it('grava a declaração com quem a colheu', async () => {
      const { svc, registros } = build();
      await svc.registrar({
        ...alvo(),
        biometria: true,
        maiorIdade: true,
        declaradoPorId: 5,
        declaradoPorNome: 'Porteiro João',
      });

      expect(registros).toHaveLength(1);
      expect(registros[0]).toMatchObject({
        aceito: 1,
        maior_idade: 1,
        doc: '12345678900',
        declarado_por_id: 5,
        declarado_por_nome: 'Porteiro João',
        versao: POLITICA_VERSAO,
      });
    });

    it('grava a recusa também — é fato a registrar', async () => {
      const { svc, registros } = build();
      await svc.registrar({ ...alvo(), biometria: false, maiorIdade: false });
      expect(registros[0].aceito).toBe(0);
    });

    it('revogar não apaga a declaração anterior — append-only', async () => {
      const ontem = new Date(Date.now() - 86400_000);
      const { svc, registros, prisma } = build([linha({ registrado_em: ontem })]);

      await svc.registrar({ ...alvo(), biometria: false, maiorIdade: true });

      expect(registros).toHaveLength(2);
      expect(prisma.consentimentos_Terceiros.update).toBeUndefined();
      expect(await svc.autorizouBiometria(alvo())).toBe(false);
    });
  });
});

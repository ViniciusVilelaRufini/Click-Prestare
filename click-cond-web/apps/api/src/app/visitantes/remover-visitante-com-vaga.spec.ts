import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';

/**
 * `Vagas.id_visitante` referencia `Visitantes` sem regra de exclusão, então o
 * MySQL assume RESTRICT. Apagar um visitante que já ocupou uma vaga de
 * garagem falhava com:
 *
 *   Foreign key constraint violated on the fields: (`id_visitante`)
 *
 * Na portaria isso virava "Falha ao remover" e o cadastro duplicado não saía.
 * A vaga precisa ser solta junto — sem apagar a linha, que é histórico.
 */
describe('VisitantesService — remover visitante que ocupa vaga', () => {
  const VISITANTE = {
    id: 10,
    id_condominio: 1,
    nome: 'Lucas Silva',
    doc_identificacao: '232.323.232-33',
    face_id: null,
    is_prestador: 0,
  };

  function build(candidatos?: any[]) {
    const chamadas: any[] = [];
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === VISITANTE.id ? { ...VISITANTE } : null,
        ),
        findMany: jest.fn(async () => candidatos ?? [
          { id: 10, face_id: null, id_condominio: 1, doc_identificacao: VISITANTE.doc_identificacao, nome: VISITANTE.nome },
          { id: 11, face_id: null, id_condominio: 1, doc_identificacao: VISITANTE.doc_identificacao, nome: VISITANTE.nome },
        ]),
        deleteMany: jest.fn((args: any) => {
          chamadas.push({ op: 'deleteMany', args });
          return Promise.resolve({ count: 2 });
        }),
        delete: jest.fn((args: any) => {
          chamadas.push({ op: 'delete', args });
          return Promise.resolve({ id: args.where.id });
        }),
      },
      vagas: {
        updateMany: jest.fn((args: any) => {
          chamadas.push({ op: 'vagas.updateMany', args });
          return Promise.resolve({ count: 1 });
        }),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const auditoria: any = { registrar: jest.fn() };
    const facial: any = { unsyncVisitante: jest.fn(async () => undefined) };
    const noop: any = {};
    const svc = new VisitantesService(
      prisma, noop, noop, facial, auditoria, noop,
    );
    return { svc, prisma, chamadas };
  }

  describe('removerPessoa (botão Remover da lista)', () => {
    it('solta a vaga antes de apagar, na mesma transação', async () => {
      const { svc, prisma, chamadas } = build();
      const r: any = await svc.removerPessoa(1, 10);

      expect(r.ok).toBe(true);
      expect(prisma.$transaction).toHaveBeenCalled();

      const vagas = chamadas.find((c) => c.op === 'vagas.updateMany');
      expect(vagas.args.where.id_visitante).toEqual({ in: [10, 11] });
      // Ponteiro limpo (o referente vai sumir) e vaga devolvida.
      expect(vagas.args.data).toEqual({ id_visitante: null, ativo: 0 });

      // A vaga é histórico: solta, nunca apagada.
      expect(chamadas.some((c) => c.op === 'vagas.deleteMany')).toBe(false);
    });

    /**
     * A lista separa "Lucas Silva" (sem documento) de "lucas silva" (com CPF)
     * em DUAS linhas, mas a exclusao casava por `nome` direto no banco — e o
     * MySQL compara texto sem diferenciar maiusculas. Clicar em Remover numa
     * linha apagava a outra junto. Duas visitantes homonimas, uma identificada
     * por documento e outra nao, viravam a mesma pessoa.
     */
    it('nao alcanca homonimo que TEM documento quando a pessoa nao tem', async () => {
      const semDoc = { id: 20, id_condominio: 1, nome: 'Lucas Silva', doc_identificacao: null, face_id: null, is_prestador: 0 };
      const { svc, prisma, chamadas } = build([
        { id: 20, face_id: null, id_condominio: 1, doc_identificacao: null, nome: 'Lucas Silva' },
        // Mesmo nome em caixa diferente, mas COM documento: outra pessoa.
        { id: 21, face_id: null, id_condominio: 1, doc_identificacao: '232.323.232-33', nome: 'lucas silva' },
      ]);
      prisma.visitantes.findUnique = jest.fn(async () => semDoc);

      await svc.removerPessoa(1, 20);

      const del = chamadas.find((c) => c.op === 'deleteMany');
      expect(del.args.where.id.in).toEqual([20]);
      expect(del.args.where.id.in).not.toContain(21);
    });

    it('agrupa as visitas de quem TEM documento, ignorando caixa', async () => {
      const { svc, chamadas } = build([
        { id: 30, face_id: null, id_condominio: 1, doc_identificacao: '232.323.232-33', nome: 'Lucas Silva' },
        { id: 31, face_id: null, id_condominio: 1, doc_identificacao: '232.323.232-33', nome: 'lucas silva' },
      ]);
      await svc.removerPessoa(1, 10);

      const del = chamadas.find((c) => c.op === 'deleteMany');
      expect(del.args.where.id.in).toEqual([30, 31]);
    });
  });

  describe('remove (uma visita só)', () => {
    it('também solta a vaga', async () => {
      const { svc, chamadas } = build();
      await svc.remove(10);

      const vagas = chamadas.find((c) => c.op === 'vagas.updateMany');
      expect(vagas.args.where.id_visitante).toBe(10);
      expect(vagas.args.data).toEqual({ id_visitante: null, ativo: 0 });
    });

    it('visitante inexistente continua dando 404', async () => {
      const { svc } = build();
      await expect(svc.remove(999)).rejects.toBeInstanceOf(NotFoundException);
    });

    /**
     * O catch engolia qualquer erro e respondia "Visitante não encontrado" —
     * foi assim que a violação de FK chegou na portaria disfarçada de cadastro
     * inexistente, mandando o operador procurar no lugar errado.
     */
    it('falha real do banco não vira mais "não encontrado"', async () => {
      const { svc, prisma } = build();
      prisma.$transaction = jest.fn(async () => {
        throw Object.assign(new Error('Foreign key constraint violated'), { code: 'P2003' });
      });

      const erro = await svc.remove(10).catch((e) => e);
      expect(erro).toBeInstanceOf(BadRequestException);
      expect(erro).not.toBeInstanceOf(NotFoundException);
      expect(erro.message).toContain('P2003');
    });
  });
});

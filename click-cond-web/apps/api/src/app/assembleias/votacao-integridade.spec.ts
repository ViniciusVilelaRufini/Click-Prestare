import { ForbiddenException } from '@nestjs/common';
import { AssembleiasController } from './assembleias.controller';
import { AssembleiasService } from './assembleias.service';

/**
 * Integridade da votação:
 *  - o voto saía com `payload.sub` como Users.id: com o token da portaria-web
 *    (sub = Funcionarios_Portaria.id) o porteiro votava — e trocava o voto —
 *    como o morador de mesmo número;
 *  - "um voto por pessoa" era só deleteMany + create, sem índice: dois
 *    toques simultâneos gravavam duas linhas e a apuração contava as duas;
 *  - data_inicio/data_termino são @db.Date e o status comparava com a data
 *    UTC do servidor: no último dia, a partir das 21h de Brasília, a votação
 *    já aparecia encerrada e recusava voto.
 */
describe('Votação — integridade', () => {
  const tzOriginal = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'UTC'; });
  afterAll(() => { process.env.TZ = tzOriginal; jest.useRealTimers(); });

  it('token da portaria não vota em nome de ninguém', () => {
    const service: any = { registerVoto: jest.fn() };
    const ctrl = new AssembleiasController(service);
    const porteiro = { sub: 42, nome: 'QA_SECURITY_20260923 porteiro', id_condominio: 1 } as any;
    expect(() => ctrl.registerVoto({ voto: { votacao_id: 5, opcao_id: 9 } }, porteiro)).toThrow(ForbiddenException);
    expect(service.registerVoto).not.toHaveBeenCalled();
  });

  it('apuração conta uma vez por pessoa, pelo voto mais recente', async () => {
    const prisma: any = {
      votacoes: {
        findMany: jest.fn(async () => [{
          id: 5, titulo: 'QA', descricao: null, data_inicio: null, data_termino: null,
          opcoes: [
            { id: 9, nome: 'Sim', votos: [
              { id: 1, id_user: 50, created_at: new Date('2026-09-23T12:00:00Z') },
              { id: 2, id_user: 50, created_at: new Date('2026-09-23T12:00:00Z') }, // toque duplo
              { id: 3, id_user: 51, created_at: new Date('2026-09-23T12:00:00Z') },
            ] },
            { id: 10, nome: 'Não', votos: [
              { id: 4, id_user: 51, created_at: new Date('2026-09-23T12:05:00Z') }, // 51 mudou de voto
            ] },
          ],
        }]),
      },
    };
    const svc = new AssembleiasService(prisma, {} as any, {} as any);
    const [v] = await (svc as any).getVotacoesFormatadas(undefined, true, undefined, 5);
    expect(v.opcoes).toEqual(['9;Sim;1', '10;Não;1']);
  });

  it('último dia às 22h de Brasília a votação continua aberta', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-24T01:00:00Z')); // 23/09 22:00 BRT
    const svc = new AssembleiasService({} as any, {} as any, {} as any);
    const status = (svc as any).calcStatusInt(new Date('2026-09-20T00:00:00Z'), new Date('2026-09-23T00:00:00Z'));
    expect(status).toBe(1);
  });

  it('primeiro dia ainda não abre às 22h de Brasília da véspera', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-24T01:00:00Z')); // 23/09 22:00 BRT
    const svc = new AssembleiasService({} as any, {} as any, {} as any);
    const status = (svc as any).calcStatusInt(new Date('2026-09-24T00:00:00Z'), new Date('2026-09-30T00:00:00Z'));
    expect(status).toBe(0);
  });
});

import { ComunicadosMobileController } from './comunicados-mobile.controller';

/** O app mostra `created_at` como veio; o servidor roda em UTC. */
describe('GET /comunicados/get-all — data no horário de Brasília', () => {
  const tzOriginal = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'UTC'; });
  afterAll(() => { process.env.TZ = tzOriginal; });

  it('comunicado das 22:15 de Brasília não aparece como 01:15 do dia seguinte', async () => {
    const service: any = {
      findAll: jest.fn(async () => [
        { id: 1, titulo: 'QA_SECURITY_20260923', descricao: null, created_at: new Date('2026-09-24T01:15:00Z') },
      ]),
    };
    const [c] = await new ComunicadosMobileController(service).getAll('1', {} as any);
    expect(c.created_at).toBe('23/09/2026 22:15');
  });
});

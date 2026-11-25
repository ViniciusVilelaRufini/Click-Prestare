import * as fs from 'fs';
import * as path from 'path';

/**
 * A Central de Relatórios lê o nome do arquivo do header Content-Disposition (CSV de auditoria,
 * zip LGPD). Em produção a chamada é cross-origin e o navegador esconde do JavaScript todo header
 * que não seja "simple response header" e não esteja em Access-Control-Expose-Headers.
 * O callback do enableCors é inline em main.ts, então o teste confere a fonte (mesmo padrão de
 * assets-estaticos.util.spec.ts).
 */
describe('main.ts — CORS expõe os headers que o front lê', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '..', '..', 'main.ts'), 'utf8');

  it('exposedHeaders inclui Date e Content-Disposition', () => {
    const m = main.match(/const exposedHeaders = \[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const headers = (m as RegExpMatchArray)[1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
    expect(headers).toEqual(expect.arrayContaining(['Date', 'Content-Disposition']));
  });

  it('as respostas de origem do front usam exposedHeaders', () => {
    expect((main.match(/credentials: true, exposedHeaders/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

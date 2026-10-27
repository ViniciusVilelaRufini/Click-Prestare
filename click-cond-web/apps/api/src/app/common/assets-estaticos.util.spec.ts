import * as fs from 'fs';
import * as path from 'path';
import { caminhoEstaticoBloqueado } from './assets-estaticos.util';

/**
 * main.ts serve dist/assets na raiz do site. O send (serve-static) DECODIFICA o
 * caminho antes de abrir o arquivo; o filtro testava o caminho cru, então
 * '/firebase-service%2Daccount.jso%6E' passava e baixava a chave do Firebase.
 */
describe('caminhoEstaticoBloqueado — compara o caminho decodificado', () => {
  it.each([
    '/firebase-service-account.json',
    '/firebase-service%2Daccount.jso%6E',
    '/firebase-service-account%2Ejson',
    '/%66irebase-service-account.json',
    '/qualquer.%4A%53%4F%4E',
    '/sub/..%2Ffirebase-service-account.json',
    '/%E0%A4%A', // percent-encoding malformado: o send devolveria 400; aqui é recusado
  ])('bloqueia %s', (p) => expect(caminhoEstaticoBloqueado(p)).toBe(true));

  it.each(['/simulator.html', '/simulador-acesso.html', '/api/facial/devices', '/', undefined])(
    'libera %s',
    (p) => expect(caminhoEstaticoBloqueado(p as any)).toBe(false),
  );

  it('main.ts usa o filtro decodificado antes do useStaticAssets', () => {
    const main = fs.readFileSync(path.resolve(__dirname, '..', '..', 'main.ts'), 'utf8');
    const idxFiltro = main.indexOf('caminhoEstaticoBloqueado(req.path)');
    const idxStatic = main.indexOf("app.useStaticAssets(join(__dirname, 'assets'))");
    expect(idxFiltro).toBeGreaterThan(-1);
    expect(idxStatic).toBeGreaterThan(idxFiltro);
  });
});

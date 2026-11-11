import * as fs from 'fs';
import * as path from 'path';
import { caminhoEstaticoBloqueado } from './assets-estaticos.util';
import {
  paginaSimuladorBloqueada,
  simuladorHabilitado,
} from './simulador-estatico.util';

/**
 * As páginas de simulador (src/assets/*.html) são copiadas para dist/assets e
 * servidas na raiz do site. Os controllers que elas chamam só são montados com
 * `FACIAL_SIMULATOR_ENABLED=true` (ver facial/simulador-fora-de-producao.spec),
 * mas o HTML seguia no ar em produção. Agora obedece à mesma variável.
 */
describe('paginaSimuladorBloqueada — HTML de simulador fora de produção', () => {
  const ASSETS = path.resolve(__dirname, '..', '..', 'assets');
  const htmlEmAssets = fs
    .readdirSync(ASSETS)
    .filter((f) => /\.html?$/i.test(f))
    .map((f) => `/${f}`);

  const DESLIGADO = {};
  const LIGADO = { FACIAL_SIMULATOR_ENABLED: 'true' };

  it('a pasta de assets tem as páginas de simulador esperadas', () => {
    expect(htmlEmAssets.sort()).toEqual(
      [
        '/simulador-acesso.html',
        '/simulator-botoeira.html',
        '/simulator-qr.html',
        '/simulator-rfid.html',
        '/simulator.html',
      ].sort(),
    );
  });

  describe('simuladorHabilitado — mesma regra do FacialModule', () => {
    it.each([
      [undefined, false],
      ['', false],
      ['false', false],
      ['0', false],
      ['1', false],
      ['yes', false],
      ['true', true],
      ['TRUE', true],
    ])('FACIAL_SIMULATOR_ENABLED=%s → %s', (valor, esperado) => {
      const env = valor === undefined ? {} : { FACIAL_SIMULATOR_ENABLED: valor };
      expect(simuladorHabilitado(env)).toBe(esperado);
    });
  });

  describe('sem a env (produção)', () => {
    it.each(htmlEmAssets)('bloqueia %s', (p) =>
      expect(paginaSimuladorBloqueada(p, DESLIGADO)).toBe(true),
    );

    it.each([
      '/simulator-rfid.html',
      '/SIMULATOR-RFID.HTML',
      '/simulator%2Drfid.html', // o send decodifica antes de abrir o arquivo
      '/simulator-rfid.htm%6C',
      '/simulator-rfid%2Ehtml',
      '/sub/..%2Fsimulator-rfid.html',
      '/qualquer-pagina-nova.html', // página nova nasce bloqueada
      '/pagina.htm',
      '/%E0%A4%A', // percent-encoding malformado
    ])('bloqueia %s', (p) =>
      expect(paginaSimuladorBloqueada(p, DESLIGADO)).toBe(true),
    );

    it.each([
      ['false'],
      ['1'],
      [''],
    ])('com a env em "%s" segue bloqueado', (valor) =>
      expect(
        paginaSimuladorBloqueada('/simulator-rfid.html', {
          FACIAL_SIMULATOR_ENABLED: valor,
        }),
      ).toBe(true),
    );

    // O filtro roda em TODA requisição: não pode derrubar a API.
    it.each([
      '/',
      '/api',
      '/api/facial/devices',
      '/api/facial/webhook/abc123',
      '/api/relatorios/html',
      '/favicon.ico',
      '/logo.png',
      undefined,
    ])('não interfere em %s', (p) =>
      expect(paginaSimuladorBloqueada(p as any, DESLIGADO)).toBe(false),
    );
  });

  describe('com FACIAL_SIMULATOR_ENABLED=true (uso local, sem hardware)', () => {
    it.each(htmlEmAssets)('libera %s', (p) =>
      expect(paginaSimuladorBloqueada(p, LIGADO)).toBe(false),
    );

    // Ligar o simulador não pode reabrir o que já era bloqueado.
    it.each([
      '/firebase-service-account.json',
      '/firebase-service%2Daccount.jso%6E',
      '/qualquer.json',
      '/%E0%A4%A',
    ])('%s continua bloqueado pelo filtro de credenciais', (p) =>
      expect(caminhoEstaticoBloqueado(p)).toBe(true),
    );
  });

  describe('sem argumento, lê process.env na hora da chamada', () => {
    const original = process.env['FACIAL_SIMULATOR_ENABLED'];
    afterEach(() => {
      if (original === undefined) delete process.env['FACIAL_SIMULATOR_ENABLED'];
      else process.env['FACIAL_SIMULATOR_ENABLED'] = original;
    });

    it('obedece à variável do processo', () => {
      delete process.env['FACIAL_SIMULATOR_ENABLED'];
      expect(paginaSimuladorBloqueada('/simulator.html')).toBe(true);
      process.env['FACIAL_SIMULATOR_ENABLED'] = 'true';
      expect(paginaSimuladorBloqueada('/simulator.html')).toBe(false);
    });
  });

  it('main.ts aplica os dois filtros antes do useStaticAssets', () => {
    const main = fs.readFileSync(path.resolve(__dirname, '..', '..', 'main.ts'), 'utf8');
    const idxCredencial = main.indexOf('caminhoEstaticoBloqueado(req.path)');
    const idxSimulador = main.indexOf('paginaSimuladorBloqueada(req.path)');
    const idxStatic = main.indexOf("app.useStaticAssets(join(__dirname, 'assets'))");
    expect(idxCredencial).toBeGreaterThan(-1);
    expect(idxSimulador).toBeGreaterThan(-1);
    expect(idxStatic).toBeGreaterThan(idxCredencial);
    expect(idxStatic).toBeGreaterThan(idxSimulador);
  });
});

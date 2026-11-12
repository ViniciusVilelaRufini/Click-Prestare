jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../auditoria/auditoria.service', () => ({ AuditoriaService: class {} }));

import * as path from 'path';

const params = {
  headerText: 'Relatório de Visitantes - Residencial Teste',
  unidade: 'Apto 106 · Bloco A',
  periodo: '01/11/2026 até 12/11/2026',
  metrics: [{ label: 'Total de Visitantes', value: '1' }],
  table: {
    widths: ['*', 'auto'],
    body: [
      ['Nome', 'Apto'].map((h) => ({ text: h, style: 'tableHeader' })),
      ['Maria', 'Apto 106 · Bloco A'],
    ],
  },
};

function gerar(): Promise<Buffer> {
  // Módulos isolados: o tema guarda cache das fontes encontradas.
  let svc: any;
  jest.isolateModules(() => {
    const { RelatoriosService } = require('./relatorios.service');
    svc = new RelatoriosService({}, undefined);
  });
  return svc.generatePdf(params);
}

describe('PDF de relatório no visual Prestare', () => {
  afterEach(() => jest.restoreAllMocks());

  it('embute Barlow e Barlow Condensed e traz a marca no rodapé', async () => {
    const pdf = (await gerar()).toString('latin1');
    expect(pdf.startsWith('%PDF')).toBe(true);
    expect(pdf).toMatch(/BaseFont \/[A-Z]{6}\+Barlow-Regular/);
    expect(pdf).toMatch(/BaseFont \/[A-Z]{6}\+BarlowCondensed-SemiBold/);
    expect(pdf).not.toContain('Click com Prestare');
  });

  it('cai para Helvetica quando as fontes não estão no disco', async () => {
    const fs = require('fs');
    const real = fs.existsSync;
    jest.spyOn(fs, 'existsSync').mockImplementation((p: any) => (String(p).includes('Barlow') ? false : real(p)));
    const pdf = (await gerar()).toString('latin1');
    expect(pdf.startsWith('%PDF')).toBe(true);
    expect(pdf).toContain('/Helvetica');
  });

  it('não deixa o pdfmake ler arquivo fora da pasta de fontes nem baixar URL', () => {
    let travar: any;
    jest.isolateModules(() => {
      travar = require('./pdf-tema').travarAcessosPdf;
    });
    const politicas: Record<string, (x: string) => boolean> = {};
    travar({
      setUrlAccessPolicy: (f: any) => (politicas.url = f),
      setLocalAccessPolicy: (f: any) => (politicas.local = f),
    });
    expect(politicas.url('https://exemplo.com/a.png')).toBe(false);
    expect(politicas.local('Helvetica')).toBe(true);
    expect(politicas.local(path.resolve('/etc/passwd'))).toBe(false);
    expect(politicas.local(path.join(__dirname, '..', '..', 'assets', 'fonts', '..', 'marca', 'x.svg'))).toBe(false);
    expect(politicas.local(path.join(__dirname, '..', '..', 'assets', 'fonts', 'Barlow-Regular.ttf'))).toBe(true);
  });
});

import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import qrcode from 'qrcode-generator';
import { TerminaisFaciaisPageComponent } from './terminais-faciais-page.component';
import { TerminaisFaciaisApi } from './terminais-faciais.service';
import { AreasSociaisApi } from '../areas-sociais/areas-sociais.service';
import { ConfirmService } from '../shared/confirm.service';
import { htmlDaFolha, svgDoQr } from './folha-qr-entregas';

/**
 * QR de entregas do portão: o síndico gera o token do aparelho que abre
 * (botoeira, catraca ou o próprio facial), imprime a folha e cola no portão.
 * O entregador lê o QR, se identifica e o morador decide.
 */

const base = { sentido: 'auto', fabricante: 'intelbras', modelo: null, ip: '192.168.3.40', porta: 80, ativo: 1 };
const BOTOEIRA = { ...base, id: 30, nome: 'Portão social', tipo: 'botoeira', token_entrega: null } as any;
const CATRACA = { ...base, id: 31, nome: 'Catraca', tipo: 'catraca', token_entrega: null } as any;
const FACIAL = { ...base, id: 33, nome: 'Facial garagem', tipo: 'facial', token_entrega: null } as any;
const TAG = { ...base, id: 32, nome: 'Leitor de tag', tipo: 'tag_reader', token_entrega: null } as any;
const TOKEN = 'a'.repeat(48);
const NOVO = 'b'.repeat(48);

const esperar = () => new Promise((r) => setTimeout(r, 0));

function build(opts: { sindico?: boolean; terminais?: any[]; confirma?: boolean } = {}) {
  const api = {
    list: jest.fn(() => of(opts.terminais ?? [BOTOEIRA, CATRACA, FACIAL, TAG])),
    syncPessoas: jest.fn(() => of([])),
    syncStatus: jest.fn(() => of({ synced: 0, pending: 0, error: 0, semFoto: 0, running: false })),
    agentInfo: jest.fn(() => of({ agent_token: 't', download_url: null })),
    agentSaude: jest.fn(() => of(null)),
    health: jest.fn(() => of({ terminais: { total: 0, offline: [], semReporteRecente: [] }, agente: { online: true, lastSeenAt: null }, fantasmas: { ultimaVarreduraEm: null, terminaisVarridos: 0, terminaisComFalha: [], removidosHoje: 0, eventosHoje: [] } })),
    descobertos: jest.fn(() => of({ recebido_em: null, achados: [], avisos: [] })),
    procurarDescobertos: jest.fn(() => of({ ok: true })),
    souSindico: jest.fn(() => opts.sindico ?? true),
    nomeCondominio: jest.fn(() => 'Residencial Demo'),
    gerarTokenEntrega: jest.fn((_id: number) => of({ token: NOVO, url: `https://www.prestarecondominios.com.br/?entrega=${NOVO}` })),
    removerTokenEntrega: jest.fn(() => of({ ok: true })),
  };
  const confirm = { ask: jest.fn(() => Promise.resolve(opts.confirma ?? true)) };
  TestBed.configureTestingModule({
    imports: [TerminaisFaciaisPageComponent],
    providers: [
      { provide: TerminaisFaciaisApi, useValue: api },
      { provide: AreasSociaisApi, useValue: { listAreas: jest.fn(() => of([])) } },
      { provide: ConfirmService, useValue: confirm },
    ],
  });
  const f = TestBed.createComponent(TerminaisFaciaisPageComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const card = (id: number) => el.querySelector(`[data-terminal="${id}"]`) as HTMLElement;
  const blocoEntregas = (id: number) => card(id).querySelector('[data-qr-entregas]') as HTMLElement | null;
  const botao = (id: number, texto: string) =>
    Array.from(blocoEntregas(id)?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === texto) as
      | HTMLButtonElement
      | undefined;
  return { f, el, tela: f.componentInstance, api, confirm, card, blocoEntregas, botao };
}

describe('TerminaisFaciaisPageComponent — QR de entregas', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('só botoeira, catraca e facial mostram a ação; leitor de tag não', () => {
    const { blocoEntregas, botao, tela } = build();
    expect(botao(30, 'Gerar QR de entregas')).toBeTruthy();
    expect(botao(31, 'Gerar QR de entregas')).toBeTruthy();
    expect(botao(33, 'Gerar QR de entregas')).toBeTruthy();
    expect(blocoEntregas(32)).toBeNull();
    tela.ngOnDestroy();
  });

  it('porteiro não vê a ação', () => {
    const { blocoEntregas, tela } = build({ sindico: false });
    [30, 31, 32, 33].forEach((id) => expect(blocoEntregas(id)).toBeNull());
    tela.ngOnDestroy();
  });

  it('"Gerar" chama a rota e passa a mostrar "Imprimir", "Gerar novo" e "Desligar"', async () => {
    const { f, api, botao, tela } = build();
    jest.spyOn(window, 'open').mockReturnValue(null);
    botao(30, 'Gerar QR de entregas')!.click();
    await esperar();
    f.detectChanges();
    expect(api.gerarTokenEntrega).toHaveBeenCalledWith(30);
    expect(botao(30, 'Gerar QR de entregas')).toBeUndefined();
    expect(botao(30, 'Imprimir QR de entregas')).toBeTruthy();
    expect(botao(30, 'Gerar novo')).toBeTruthy();
    expect(botao(30, 'Desligar')).toBeTruthy();
    tela.ngOnDestroy();
  });

  it('"Gerar novo" só chama a rota depois da confirmação', async () => {
    const cancela = build({ terminais: [{ ...BOTOEIRA, token_entrega: TOKEN }], confirma: false });
    cancela.botao(30, 'Gerar novo')!.click();
    await esperar();
    expect(cancela.confirm.ask).toHaveBeenCalledWith(expect.objectContaining({ message: 'O QR impresso deixa de valer. Continuar?' }));
    expect(cancela.api.gerarTokenEntrega).not.toHaveBeenCalled();
    cancela.tela.ngOnDestroy();
    TestBed.resetTestingModule();

    const confirma = build({ terminais: [{ ...BOTOEIRA, token_entrega: TOKEN }], confirma: true });
    jest.spyOn(window, 'open').mockReturnValue(null);
    confirma.botao(30, 'Gerar novo')!.click();
    await esperar();
    expect(confirma.api.gerarTokenEntrega).toHaveBeenCalledWith(30);
    confirma.tela.ngOnDestroy();
  });

  it('"Desligar" confirma, chama a rota e volta a oferecer "Gerar"', async () => {
    const { f, api, botao, confirm, tela } = build({ terminais: [{ ...BOTOEIRA, token_entrega: TOKEN }] });
    botao(30, 'Desligar')!.click();
    await esperar();
    f.detectChanges();
    expect(confirm.ask).toHaveBeenCalled();
    expect(api.removerTokenEntrega).toHaveBeenCalledWith(30);
    expect(botao(30, 'Gerar QR de entregas')).toBeTruthy();
    tela.ngOnDestroy();
  });

  it('"Imprimir" abre a folha numa janela nova, com o QR do link do portão, e chama a impressão', () => {
    const { botao, tela } = build({ terminais: [{ ...BOTOEIRA, token_entrega: TOKEN }] });
    const escrito: string[] = [];
    const janela = {
      document: { write: jest.fn((s: string) => escrito.push(s)), close: jest.fn() },
      focus: jest.fn(),
      print: jest.fn(),
    };
    const open = jest.spyOn(window, 'open').mockReturnValue(janela as any);
    botao(30, 'Imprimir QR de entregas')!.click();

    expect(open).toHaveBeenCalled();
    const html = escrito.join('');
    expect(html).toContain('Entregas');
    expect(html).toContain('Residencial Demo');
    expect(html).toContain('Portão social');
    expect(html).toContain(svgDoQr(`${window.location.origin}/?entrega=${TOKEN}`));
    expect(janela.print).toHaveBeenCalled();
    tela.ngOnDestroy();
  });

  it('pop-up bloqueado: avisa em vez de falhar calado', () => {
    const { botao, tela } = build({ terminais: [{ ...BOTOEIRA, token_entrega: TOKEN }] });
    jest.spyOn(window, 'open').mockReturnValue(null);
    botao(30, 'Imprimir QR de entregas')!.click();
    expect(tela.errorMessage()).toContain('pop-up');
    tela.ngOnDestroy();
  });
});

describe('htmlDaFolha', () => {
  const svg = svgDoQr('https://www.prestarecondominios.com.br/?entrega=abc');
  const html = htmlDaFolha({ condominio: 'Residencial Demo', portao: 'Portão social', svgQr: svg });

  it('tem título, chamada, condomínio, portão e o SVG recebido; nada de serviço de QR de terceiro', () => {
    expect(html).toContain('Entregas');
    expect(html).toContain('Aponte a câmera aqui');
    expect(html).toContain('Residencial Demo');
    expect(html).toContain('Portão social');
    expect(html).toContain(svg);
    expect(html).not.toContain('qrserver');
    expect(html).not.toMatch(/<img|<script|src=/i);
  });

  it('A5, fundo branco e texto preto; QR com pelo menos 60 mm', () => {
    expect(html).toContain('size: A5');
    expect(html).toMatch(/background: #fff/);
    expect(html).toMatch(/color: #000/);
    const mm = Number(/width="(\d+)mm"/.exec(svg)?.[1]);
    expect(mm).toBeGreaterThanOrEqual(60);
  });

  it('nome do condomínio ou do portão vira texto, nunca HTML', () => {
    const h = htmlDaFolha({ condominio: '<b>x</b>', portao: '"><script>alert(1)</script>', svgQr: '' });
    expect(h).not.toContain('<script>alert');
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('svgDoQr desenha os módulos do texto com margem de 4', () => {
    const texto = 'https://www.prestarecondominios.com.br/?entrega=abc';
    const qr = qrcode(0, 'M');
    qr.addData(texto, 'Byte');
    qr.make();
    const lado = qr.getModuleCount() + 8;
    expect(svg).toContain(`viewBox="0 0 ${lado} ${lado}"`);
    let escuros = 0;
    for (let r = 0; r < qr.getModuleCount(); r++) for (let c = 0; c < qr.getModuleCount(); c++) if (qr.isDark(r, c)) escuros++;
    expect((svg.match(/h1v1h-1z/g) ?? []).length).toBe(escuros);
    expect(svg).toContain('M4,4h1v1h-1z'); // canto do padrão de posição
  });
});

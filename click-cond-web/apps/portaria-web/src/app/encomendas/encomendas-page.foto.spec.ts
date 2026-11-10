import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { EncomendasPageComponent } from './encomendas-page.component';
import { EncomendasApi } from './encomendas.service';
import { LeituraEtiqueta, reduzirImagem } from './foto-encomenda';

jest.mock('./foto-encomenda', () => ({
  ...jest.requireActual('./foto-encomenda'),
  reduzirImagem: jest.fn(),
}));
const reduzir = reduzirImagem as jest.MockedFunction<typeof reduzirImagem>;

/** Promise controlada pelo teste: simula a decodificação da foto, que no navegador demora. */
function adiado<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const leituraCompleta: LeituraEtiqueta = {
  leitura: {
    nome: 'Rafael Costa', apto: '101', bloco: 'A', transportadora: 'Shopee',
    codigo_rastreio: 'BR123', descricao: 'Caixa média Shopee',
  },
  destinatario: { apto: '101', bloco: 'A', nome: 'Rafael Costa' },
};

describe('EncomendasPageComponent — foto e leitura da etiqueta (zoneless, sem detectChanges após o async)', () => {
  const apto = { id: 1, bloco: 'A', apto: '101' };
  const api = { list: jest.fn(), create: jest.fn(), notificar: jest.fn(), lerEtiqueta: jest.fn() };

  async function montarComFormAberto() {
    api.list.mockReturnValue(of([]));
    TestBed.configureTestingModule({
      imports: [EncomendasPageComponent],
      providers: [
        provideRouter([]),
        { provide: EncomendasApi, useValue: api },
        { provide: ApartamentosApi, useValue: { list: () => of([apto]) } },
      ],
    });
    const fixture = TestBed.createComponent(EncomendasPageComponent);
    await fixture.whenStable();
    const abrir = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((b) => b.textContent?.trim() === 'Receber encomenda')!;
    abrir.click();
    await fixture.whenStable();
    return fixture;
  }

  const area = (f: ComponentFixture<EncomendasPageComponent>) =>
    f.nativeElement.querySelector('[data-testid="foto-encomenda"]') as HTMLElement;
  const formEl = (f: ComponentFixture<EncomendasPageComponent>) =>
    f.nativeElement.querySelector('[data-testid="form-encomenda"]') as HTMLElement;

  function escolherFoto(f: ComponentFixture<EncomendasPageComponent>) {
    const input = area(f).querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'etiqueta.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  /** Dá tempo para a decodificação/HTTP assentarem e para o scheduler zoneless rodar (se algo o acionou). */
  async function assentar(f: ComponentFixture<EncomendasPageComponent>) {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0));
      await f.whenStable();
    }
  }

  afterEach(() => jest.clearAllMocks());

  it('mostra a prévia e o que a etiqueta preencheu sem detecção manual', async () => {
    const f = await montarComFormAberto();
    const decod = adiado<string>();
    reduzir.mockReturnValue(decod.promise);
    const leitura$ = new Subject<LeituraEtiqueta>();
    api.lerEtiqueta.mockReturnValue(leitura$);

    escolherFoto(f);
    await assentar(f); // o CD do evento change já passou; a foto ainda está decodificando
    decod.resolve('data:image/jpeg;base64,QUFB');
    await assentar(f);

    const img = area(f).querySelector('img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('data:image/jpeg;base64,QUFB');
    expect(area(f).textContent).toContain('Lendo etiqueta…');

    leitura$.next(leituraCompleta);
    leitura$.complete();
    await assentar(f);

    expect(area(f).textContent).toContain('Preenchido pela etiqueta — confira');
    expect(area(f).textContent).not.toContain('Lendo etiqueta…');
    const descricao = formEl(f).querySelector('input[placeholder^="Ex: Caixa pequena"]') as HTMLInputElement;
    expect(descricao.value).toBe('Caixa média Shopee');
    const select = formEl(f).querySelector('select[aria-label="Destinatário (Bloco / Apto)"]') as HTMLSelectElement;
    expect(select.selectedIndex).toBeGreaterThan(0);
    expect(f.componentInstance.selectedApto).toEqual(apto);
  });

  it('"Lendo etiqueta…" continua quando chega (ou falha) a resposta de uma foto já trocada', async () => {
    const f = await montarComFormAberto();
    const leituraA$ = new Subject<LeituraEtiqueta>();
    const leituraB$ = new Subject<LeituraEtiqueta>();
    reduzir.mockResolvedValueOnce('data:image/jpeg;base64,QQ==').mockResolvedValueOnce('data:image/jpeg;base64,Qg==');
    api.lerEtiqueta.mockReturnValueOnce(leituraA$).mockReturnValueOnce(leituraB$);

    escolherFoto(f);
    await assentar(f);
    escolherFoto(f);
    await assentar(f);
    expect(api.lerEtiqueta).toHaveBeenCalledTimes(2);

    leituraA$.next(leituraCompleta);
    leituraA$.complete();
    await assentar(f);
    expect(area(f).textContent).toContain('Lendo etiqueta…');
    expect(f.componentInstance.novo.descricao).toBe('');

    leituraB$.error(new Error('falhou'));
    await assentar(f);
    expect(area(f).textContent).not.toContain('Lendo etiqueta…');
  });

  it('erro de uma foto já trocada não desliga o "Lendo etiqueta…" da foto atual', async () => {
    const f = await montarComFormAberto();
    const leituraA$ = new Subject<LeituraEtiqueta>();
    const leituraB$ = new Subject<LeituraEtiqueta>();
    reduzir.mockResolvedValueOnce('data:image/jpeg;base64,QQ==').mockResolvedValueOnce('data:image/jpeg;base64,Qg==');
    api.lerEtiqueta.mockReturnValueOnce(leituraA$).mockReturnValueOnce(leituraB$);

    escolherFoto(f);
    await assentar(f);
    escolherFoto(f);
    await assentar(f);

    leituraA$.error(new Error('timeout'));
    await assentar(f);
    expect(area(f).textContent).toContain('Lendo etiqueta…');

    leituraB$.next(leituraCompleta);
    leituraB$.complete();
    await assentar(f);
    expect(area(f).textContent).not.toContain('Lendo etiqueta…');
    expect(area(f).textContent).toContain('Preenchido pela etiqueta — confira');
  });

  it('foto que o navegador não abre mostra aviso e o formulário segue manual', async () => {
    const f = await montarComFormAberto();
    reduzir.mockRejectedValue(new Error('imagem inválida'));

    escolherFoto(f);
    await assentar(f);

    expect(formEl(f).textContent).toContain('Não foi possível abrir a foto');
    expect(api.lerEtiqueta).not.toHaveBeenCalled();
    expect(area(f).querySelector('img')).toBeNull();

    // segue utilizável: cadastro manual funciona e limpa o aviso
    api.create.mockReturnValue(of({}));
    f.componentInstance.novo.descricao = 'Caixa';
    f.componentInstance.selectedApto = apto as any;
    f.componentInstance.registrar();
    await assentar(f);
    expect(api.create).toHaveBeenCalled();
    expect(f.nativeElement.textContent).not.toContain('Não foi possível abrir a foto');
  });

  it('falha da leitura (inclusive timeout) é silenciosa e deixa o formulário manual', async () => {
    const f = await montarComFormAberto();
    reduzir.mockResolvedValue('data:image/jpeg;base64,QUFB');
    const leitura$ = new Subject<LeituraEtiqueta>();
    api.lerEtiqueta.mockReturnValue(leitura$);

    escolherFoto(f);
    await assentar(f);
    leitura$.error(Object.assign(new Error('Timeout has occurred'), { name: 'TimeoutError' }));
    await assentar(f);

    expect(area(f).textContent).not.toContain('Lendo etiqueta…');
    expect(area(f).textContent).not.toContain('Preenchido pela etiqueta');
    expect(f.componentInstance.formError()).toBeNull();
    expect(area(f).querySelector('img')).not.toBeNull();
  });
});

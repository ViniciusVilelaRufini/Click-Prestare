import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { EncomendasPageComponent } from './encomendas-page.component';
import { EncomendasApi } from './encomendas.service';

/**
 * Zoneless: callbacks do ZXing e do getUserMedia chegam fora de evento do template.
 * Estes testes NÃO chamam detectChanges depois do callback: só `whenStable`.
 */
describe('EncomendasPageComponent — scanner e webcam sem zone.js', () => {
  const api = { list: jest.fn(), create: jest.fn() };
  const w = window as any;
  const mediaOriginal = (navigator as any).mediaDevices;

  async function montar() {
    api.list.mockReturnValue(of([]));
    TestBed.configureTestingModule({
      imports: [EncomendasPageComponent],
      providers: [
        provideRouter([]),
        { provide: EncomendasApi, useValue: api },
        { provide: ApartamentosApi, useValue: { list: () => of([{ id: 1, bloco: 'A', apto: '101' }]) } },
      ],
    });
    const fixture = TestBed.createComponent(EncomendasPageComponent);
    await fixture.whenStable();
    return fixture;
  }

  const botao = (f: ComponentFixture<EncomendasPageComponent>, texto: string) =>
    (Array.from(f.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((b) => b.textContent?.trim().includes(texto));
  const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function assentar(f: ComponentFixture<EncomendasPageComponent>) {
    for (let i = 0; i < 3; i++) { await esperar(0); await f.whenStable(); }
  }

  afterEach(() => {
    delete w.ZXing;
    Object.defineProperty(navigator, 'mediaDevices', { value: mediaOriginal, configurable: true });
    jest.restoreAllMocks();
    jest.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('leitura do ZXing fecha o modal e preenche o campo na tela', async () => {
    let aoLer!: (r: any) => void;
    w.ZXing = {
      BrowserMultiFormatReader: class {
        listVideoInputDevices = async () => [{ deviceId: 'd1', label: 'back' }];
        decodeFromVideoDevice = (_d: string, _v: any, cb: (r: any) => void) => { aoLer = cb; };
        reset = jest.fn();
      },
    };
    const f = await montar();
    botao(f, 'Receber encomenda')!.click();
    await f.whenStable();
    botao(f, 'Escanear Etiqueta')!.click();
    await f.whenStable();
    await esperar(350); // o código espera 300 ms o <video> existir
    expect(f.nativeElement.querySelector('#scanVideo')).not.toBeNull();

    aoLer({ text: 'AB123456789BR' });
    await assentar(f);

    expect(f.nativeElement.querySelector('#scanVideo')).toBeNull();
    const valores = (Array.from(f.nativeElement.querySelectorAll('input')) as HTMLInputElement[]).map((i) => i.value);
    expect(valores.join('|')).toContain('AB123456789BR');
  });

  it('sem câmera: a mensagem de erro aparece mesmo com o modal do scanner fechado', async () => {
    w.ZXing = {
      BrowserMultiFormatReader: class {
        listVideoInputDevices = async () => [];
        reset = jest.fn();
      },
    };
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = await montar();
    botao(f, 'Receber encomenda')!.click();
    await f.whenStable();
    botao(f, 'Escanear Etiqueta')!.click();
    await assentar(f);

    expect(f.nativeElement.querySelector('#scanVideo')).toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="erro-scanner"]')?.textContent).toContain('Nenhuma câmera encontrada.');

    botao(f, 'Fechar')!.click();
    await assentar(f);
    expect(f.nativeElement.querySelector('[data-testid="erro-scanner"]')).toBeNull();
  });

  it('webcam negada: a caixa de captura some e volta o botão "Tirar Foto"', async () => {
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.reject(new Error('negado')) }, configurable: true,
    });
    const f = await montar();
    f.componentInstance.abrirRetirada({ id: 9, descricao: 'Caixa', destinatario_apto: '101', status: 'Aguardando' } as any);
    await f.whenStable();
    botao(f, 'Tirar Foto')!.click();
    await assentar(f);

    expect(window.alert).toHaveBeenCalled();
    expect(f.nativeElement.querySelector('#webcamVideo')).toBeNull();
    expect(botao(f, 'Capturar')).toBeUndefined();
    expect(botao(f, 'Tirar Foto')).toBeDefined();
  });

  it('capturePhoto sem stream ativo não grava foto', async () => {
    const f = await montar();
    const c = f.componentInstance;
    const video = document.createElement('video');
    video.id = 'webcamVideo';
    document.body.appendChild(video);
    c.capturePhoto();
    video.remove();
    expect(c.capturedPhoto).toBeNull();
  });
});

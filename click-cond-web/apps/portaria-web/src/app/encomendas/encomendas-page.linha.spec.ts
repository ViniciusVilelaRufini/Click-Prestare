import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { EncomendasPageComponent } from './encomendas-page.component';
import { Encomenda, EncomendasApi } from './encomendas.service';

/** Textos da linha da tabela de encomendas (recebida/armazenada e destinatário). */
describe('EncomendasPageComponent — linha da tabela', () => {
  const tela = Object.create(EncomendasPageComponent.prototype) as EncomendasPageComponent;
  const diasAtras = (d: number) => new Date(Date.now() - d * 86_400_000 - 60_000).toISOString();

  it.each([
    [0, 'hoje', 'ok'],
    [1, 'há 1 dia', 'ok'],
    [3, 'há 3 dias', 'atencao'],
    [8, 'há 8 dias', 'critico'],
  ])('%s dia(s) armazenada → "%s" (%s)', (dias, texto, nivel) => {
    const e: any = { status: 'Aguardando', recebido_em: diasAtras(dias as number) };
    expect(tela.textoArmazenada(e)).toBe(texto);
    expect(tela.nivelArmazenada(e)).toBe(nivel);
  });

  it('retirada não fica em alerta, mesmo antiga', () => {
    const e: any = { status: 'Retirada', recebido_em: diasAtras(10), retirado_em: new Date().toISOString() };
    expect(tela.nivelArmazenada(e)).toBe('ok');
  });

  it.each([
    [{ destinatario_bloco: 'Bloco A', destinatario_apto: '101' }, 'Apto 101 · Bloco A'],
    [{ destinatario_bloco: 'A', destinatario_apto: '101' }, 'Apto 101 · Bloco A'],
    [{ destinatario_bloco: null, destinatario_apto: '101' }, 'Apto 101'],
  ])('destinatário %o → "%s"', (e, texto) => {
    expect(tela.rotuloDestino(e as any)).toBe(texto);
  });

  it.each([
    ['A', 'Bloco A'],
    ['Bloco A', 'Bloco A'],
    ['bloco b', 'bloco b'],
  ])('filtro de blocos: "%s" → "%s" (não duplica o prefixo)', (bloco, texto) => {
    expect(tela.rotuloBloco(bloco)).toBe(texto);
  });

  describe('foto do volume na tabela', () => {
    const enc = (over: Partial<Encomenda>): Encomenda => ({
      id: 1, descricao: 'Caixa', destinatario_apto: '101', destinatario_bloco: 'A',
      recebido_de: null, recebido_em: '2026-10-05T14:30:00', retirado_em: null, retirado_por: null,
      status: 'Aguardando', ...over,
    });
    function montar(lista: Encomenda[]) {
      TestBed.configureTestingModule({
        imports: [EncomendasPageComponent],
        providers: [
          provideRouter([]),
          { provide: EncomendasApi, useValue: { list: () => of(lista) } },
          { provide: ApartamentosApi, useValue: { list: () => of([]) } },
        ],
      });
      const fixture = TestBed.createComponent(EncomendasPageComponent);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('com foto_volume renderiza .ps-mor-foto img na célula do volume', () => {
      const el = montar([enc({ foto_volume: 'https://cdn/x.jpg' })]);
      const img = el.querySelector('table tbody td.ps-mor-celula .ps-mor-foto img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toBe('https://cdn/x.jpg');
    });

    it('sem foto_volume não renderiza .ps-mor-foto nem muda a célula', () => {
      const el = montar([enc({ foto_volume: null })]);
      expect(el.querySelector('table tbody .ps-mor-foto')).toBeNull();
      expect(el.querySelector('table tbody td.ps-mor-celula')).toBeNull();
    });
  });
});

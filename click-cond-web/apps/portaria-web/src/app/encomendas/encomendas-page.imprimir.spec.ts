import { signal } from '@angular/core';
import { EncomendasPageComponent } from './encomendas-page.component';

/**
 * O morador pré-cadastra a encomenda (descricao, recebido_de, apto, bloco) e o
 * porteiro imprime a etiqueta: o HTML ia por document.write num popup com a
 * origem da portaria — um <img onerror> lia o token do operador.
 */
describe('EncomendasPageComponent — etiqueta impressa escapa os campos', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const encomenda: any = {
    id: 7,
    destinatario_bloco: `B${payload}`,
    destinatario_apto: `101${payload}`,
    descricao: `Caixa ${payload}`,
    recebido_de: `Loja ${payload}`,
    recebido_em: '2026-10-20T12:00:00Z',
    status: 'Esperando',
  };
  let escrito: string;
  let openSpy: jest.SpyInstance;

  beforeEach(() => {
    escrito = '';
    const popup: any = {
      document: {
        write: (h: string) => {
          escrito += h;
        },
        close: () => undefined,
      },
    };
    openSpy = jest.spyOn(window, 'open').mockReturnValue(popup);
  });

  afterEach(() => openSpy.mockRestore());

  function tela(): EncomendasPageComponent {
    const t = Object.create(EncomendasPageComponent.prototype) as any;
    t.encomendas = signal([encomenda]);
    t.selecionadas = signal(new Set([7]));
    return t;
  }

  it('imprimir() não injeta HTML vindo do morador', () => {
    tela().imprimir(encomenda);
    expect(escrito).not.toContain('<img');
    expect(escrito).toContain('Caixa &lt;img src=x onerror=alert(1)&gt;');
    expect(escrito).toContain('Loja &lt;img');
    expect(escrito).toContain('B&lt;img');
    expect(escrito).toContain('101&lt;img');
  });

  it('imprimirLote() não injeta HTML vindo do morador', () => {
    tela().imprimirLote();
    expect(escrito).not.toContain('<img');
    expect(escrito).toContain('Caixa &lt;img src=x onerror=alert(1)&gt;');
    expect(escrito).toContain('101&lt;img');
    expect(escrito).toContain('B&lt;img');
  });
});

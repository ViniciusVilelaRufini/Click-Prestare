import { EncomendasPageComponent } from './encomendas-page.component';

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
});

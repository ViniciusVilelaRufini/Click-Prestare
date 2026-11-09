import { NavigationError } from '@angular/router';
import { recarregarSeVersaoMudou } from './recarga-apos-publicacao';

/**
 * Depois de uma publicação, a aba aberta pede os pedaços da versão antiga, que
 * já não existem: a navegação falhava em silêncio e a tela ficava no Dashboard.
 */
describe('recarga após publicação', () => {
  const erro = (mensagem: string, url = '/visitantes') =>
    new NavigationError(1, url, new TypeError(mensagem));

  let recarregar: jest.Mock;

  beforeEach(() => {
    sessionStorage.clear();
    recarregar = jest.fn();
  });

  it.each([
    'Failed to fetch dynamically imported module: http://x/chunk-ABC.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
  ])('recarrega na tela pedida quando o pedaço não carrega (%s)', (mensagem) => {
    recarregarSeVersaoMudou(erro(mensagem), recarregar, 1_000);
    expect(recarregar).toHaveBeenCalledWith('/visitantes');
  });

  it('não recarrega por outros erros de navegação', () => {
    recarregarSeVersaoMudou(erro('Cannot match any routes'), recarregar, 1_000);
    expect(recarregar).not.toHaveBeenCalled();
  });

  it('recarrega uma vez só se o pedaço continuar faltando', () => {
    recarregarSeVersaoMudou(erro('Failed to fetch dynamically imported module'), recarregar, 1_000);
    recarregarSeVersaoMudou(erro('Failed to fetch dynamically imported module'), recarregar, 5_000);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it('volta a recarregar depois de um tempo, numa nova publicação', () => {
    recarregarSeVersaoMudou(erro('Failed to fetch dynamically imported module'), recarregar, 1_000);
    recarregarSeVersaoMudou(erro('Failed to fetch dynamically imported module'), recarregar, 120_000);
    expect(recarregar).toHaveBeenCalledTimes(2);
  });
});

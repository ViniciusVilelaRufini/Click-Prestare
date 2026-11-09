import { NavigationError } from '@angular/router';

const CHAVE = 'prestare:recarga-apos-publicacao';
const INTERVALO_MS = 60_000;

/**
 * Cada publicação troca os nomes dos pedaços da aplicação. Uma aba aberta antes
 * dela pede os pedaços antigos, o servidor responde 404 e a navegação falhava
 * em silêncio: a tela ficava no Dashboard. Recarrega direto na tela pedida, que
 * vem na versão nova. Uma vez por minuto no máximo, para nunca entrar em laço
 * se o pedaço faltar de verdade.
 */
export function recarregarSeVersaoMudou(
  evento: NavigationError,
  recarregar: (url: string) => void = (url) => window.location.assign(url),
  agora: number = Date.now(),
): void {
  const mensagem = String((evento.error as Error | undefined)?.message ?? evento.error ?? '');
  if (!/dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(mensagem)) return;
  try {
    const ultima = sessionStorage.getItem(CHAVE);
    if (ultima && agora - Number(ultima) < INTERVALO_MS) return;
    sessionStorage.setItem(CHAVE, String(agora));
  } catch {
    // Sem sessionStorage não há como evitar o laço: não recarrega.
    return;
  }
  recarregar(evento.url);
}

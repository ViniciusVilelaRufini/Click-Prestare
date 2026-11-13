import { rotuloPortaria } from './autor-ocorrencia.util';

/** `include` do autor da mensagem — o mesmo em toda leitura do chat. */
export const INCLUDE_AUTOR_MENSAGEM = {
  usuario: { select: { id: true, name: true, login_type: true, is_sindico: true } },
} as const;

type MensagemDoBanco = {
  id_usuario: number | null;
  nome_autor?: string | null;
  usuario?: { id: number; name: string | null; login_type: string | null; is_sindico: number | null } | null;
  [k: string]: unknown;
};

/**
 * Forma da mensagem do chat em toda resposta (console, app, CRM).
 *
 * A mensagem do porteiro do console não tem Users.id (`id_usuario` NULL) e
 * por isso vinha sem `usuario`. O app lê `msg['id_usuario'].toString()` (null
 * nunca casa com o id de quem está logado) e `msg['usuario']['name']`, então
 * `usuario` vem preenchido com o rótulo "Portaria · <nome>" e `is_sindico` 0:
 * a mensagem não passa por síndico nem por morador. `autor_tipo` é novo e diz
 * de onde veio, para a tela do console pôr o balão do lado da casa.
 */
export function mensagemParaResposta<T extends MensagemDoBanco>(m: T) {
  if (m.id_usuario != null) return { ...m, autor_tipo: 'usuario' as const };
  return {
    ...m,
    autor_tipo: 'portaria' as const,
    usuario: { id: null, name: rotuloPortaria(m.nome_autor), login_type: 'portaria', is_sindico: 0 },
  };
}

import { AUTORIZACAO_EXPIRACAO_MS, AUTORIZACAO_SEM_RESPOSTA_MS } from './visitantes.service';
import {
  autorizacaoExpirada,
  janelaEncerrada,
  statusVisitante,
  VisitaParaStatus,
} from '../core/status-visitante.util';

/** Linha da lista (Pessoa/Visitante): além da visita, traz o que só a lista tem. */
export interface LinhaStatusVisita extends VisitaParaStatus {
  /** Pessoa sem visita nenhuma (a lista agregada manda `totalVisitas: 0`). */
  totalVisitas?: number;
  /** Último pedido ao morador venceu sem resposta (campo da lista). */
  pedido_expirado?: boolean;
}

export type TomStatusVisita = 'ok' | 'warn' | 'ink' | 'danger';

export type ChaveStatusVisita =
  | 'sem-visita'
  | 'presente'
  | 'sem-resposta'
  | 'aguardando-morador'
  | 'auth-autorizado'
  | 'negado'
  | 'expirado'
  | 'liberado'
  | 'autorizado'
  | 'agendado'
  | 'pedido-expirado'
  | 'janela-encerrada'
  | 'saiu';

export interface RotuloStatusVisita {
  chave: ChaveStatusVisita;
  label: string;
  tom: TomStatusVisita;
  /** Aviso extra ao lado do rótulo (hoje só "Dentro há mais de 12 h"). */
  alerta?: string;
}

/** Permanência acima disso sem baixa: provavelmente saiu sem passar pelo terminal. */
export const PERMANENCIA_LONGA_MS = 12 * 3600_000;

/**
 * Rótulo de status de uma visita — a MESMA decisão que a lista de Visitantes
 * faz no template (ramos em visitantes-page.component.html, layout celular e
 * tabela), na mesma ordem. O detalhe da visita usa esta função com a linha
 * clicada: o objeto do detalhe (API) não traz auth_status/liberado/
 * pedido_expirado e caía em "Aguardando entrada" para visita já expirada.
 *
 * Se mudar um ramo da lista, mude aqui (o spec da página confere que os dois
 * dão o mesmo texto).
 */
export function rotuloStatusVisita(v: LinhaStatusVisita, agoraMs: number): RotuloStatusVisita {
  if (v.totalVisitas !== undefined && v.totalVisitas <= 0) {
    return { chave: 'sem-visita', label: 'Sem visita', tom: 'ink' };
  }
  const status = statusVisitante(v, agoraMs);
  if (status === 'presente') {
    const r: RotuloStatusVisita = { chave: 'presente', label: 'No condomínio', tom: 'ok' };
    if (v.data_entrada && agoraMs - new Date(v.data_entrada).getTime() > PERMANENCIA_LONGA_MS) {
      r.alerta = 'Dentro há mais de 12 h';
    }
    return r;
  }
  const expirada = autorizacaoExpirada(v, agoraMs);
  if (v.auth_status === 'pendente' && !expirada) {
    const sol = v.auth_solicitado_em ? agoraMs - new Date(v.auth_solicitado_em).getTime() : null;
    const semResposta = sol != null && sol > AUTORIZACAO_SEM_RESPOSTA_MS && sol <= AUTORIZACAO_EXPIRACAO_MS;
    return semResposta
      ? { chave: 'sem-resposta', label: 'Sem resposta', tom: 'warn' }
      : { chave: 'aguardando-morador', label: 'Aguardando morador', tom: 'warn' };
  }
  if (v.auth_status === 'autorizado' && !expirada) {
    return { chave: 'auth-autorizado', label: 'Autorizado', tom: 'ok' };
  }
  if (v.auth_status === 'negado' && !expirada) {
    return { chave: 'negado', label: 'Negado', tom: 'danger' };
  }
  switch (status) {
    case 'expirado':
      return { chave: 'expirado', label: 'Autorização expirada', tom: 'warn' };
    case 'liberado':
      return { chave: 'liberado', label: 'Liberado', tom: 'ink' };
    case 'autorizado':
      return { chave: 'autorizado', label: 'Autorizado', tom: 'ok' };
    case 'agendado':
      return { chave: 'agendado', label: 'Agendado', tom: 'ink' };
    default:
      if (v.pedido_expirado) return { chave: 'pedido-expirado', label: 'Pedido expirado', tom: 'warn' };
      if (janelaEncerrada(v, agoraMs)) return { chave: 'janela-encerrada', label: 'Janela encerrada', tom: 'ink' };
      return { chave: 'saiu', label: 'Saiu', tom: 'ink' };
  }
}

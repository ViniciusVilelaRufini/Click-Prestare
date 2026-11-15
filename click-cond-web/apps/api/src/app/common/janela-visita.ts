import { AUTORIZACAO_EXPIRACAO_MS } from './autorizacao-expiracao';

/**
 * Tolerância depois do fim da janela da visita: o terminal facial e o Validar
 * PIN aceitam até 15 min além do `data_hora_termino`. A lista da portaria usa
 * a mesma para não dizer "encerrada" de quem o portão ainda deixa passar.
 * Constante única da API — nada de cópias numéricas.
 */
export const TOLERANCIA_JANELA_MS = 15 * 60 * 1000;

type CamposAutorizacao = {
  auth_status?: string | null;
  auth_respondido_em?: Date | string | null;
  auth_respondido_por?: number | null;
  data_entrada?: Date | string | null;
};

/**
 * Autorização REMOTA: a liberação veio da resposta do morador, pelo app, a um
 * pedido da portaria (portaria remota). É o que o `autorizar` grava:
 * `auth_status = 'autorizado'` com `auth_respondido_em` e
 * `auth_respondido_por` = Users.id de quem respondeu.
 *
 * A portaria que resolve o pedido no console (Registrar Entrada / Liberar
 * sobre um pedido pendente) também grava 'autorizado', mas o porteiro não tem
 * Users.id: `auth_respondido_por` fica nulo (o mesmo critério do card ao vivo,
 * `pelaPortaria = idUser == null`). Pré-autorização do morador, recorrente,
 * prestador e "Cadastrar e liberar" nem passam por pedido (auth_status nulo).
 */
export function ehAutorizacaoRemota(v: CamposAutorizacao | null | undefined): boolean {
  return v?.auth_status === 'autorizado' && v.auth_respondido_por != null && !!v.auth_respondido_em;
}

/**
 * Até quando (ms) a autorização remota ainda abre o portão: 10 min depois da
 * resposta, o mesmo prazo do console (`isAutorizacaoAtual`), sem a tolerância
 * da janela — ela existe para quem chega atrasado a uma visita marcada; aqui a
 * pessoa já estava no portão quando o morador respondeu, e o console diz
 * "expirada" aos 10 min.
 *
 * `null` quando não se aplica: não é autorização remota, ou a pessoa já ENTROU
 * por ela — quem está dentro sai pela regra de "dentro", e a visita usada que
 * mantém a liberação na saída (prestador, recorrente, vaga) volta a valer pela
 * janela própria.
 */
export function prazoAutorizacaoRemotaMs(v: CamposAutorizacao | null | undefined): number | null {
  if (!ehAutorizacaoRemota(v) || v!.data_entrada) return null;
  return new Date(v!.auth_respondido_em as any).getTime() + AUTORIZACAO_EXPIRACAO_MS;
}

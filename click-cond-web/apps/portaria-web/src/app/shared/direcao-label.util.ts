/**
 * Selo (badge) de um evento a partir do campo `direcao` retornado pela API
 * (dashboard e relatórios — ver apps/api/src/app/dashboard/dashboard.service.ts
 * e apps/api/src/app/relatorios/relatorios.service.ts).
 *
 * Eventos reais de acesso de pessoas mostram Entrada/Saída/Bloqueado.
 * Eventos de status de dispositivo (AuditLog "dispositivos", ações
 * OFFLINE/ONLINE) têm selo próprio Offline/Online — não são entrada/saída
 * de ninguém, então não podem herdar o texto de acesso de pessoas.
 *
 * Sem `direcao` definida, cai no `tipo` do evento (ex.: "Encomenda").
 */
export function direcaoLabel(direcao: string | undefined | null, tipo: string): string {
  switch (direcao) {
    case 'entrada': return 'Entrada';
    case 'saida': return 'Saída';
    case 'offline': return 'Offline';
    case 'online': return 'Online';
    case 'negado':
    case 'bloqueado': return 'Bloqueado';
    default: return tipo;
  }
}

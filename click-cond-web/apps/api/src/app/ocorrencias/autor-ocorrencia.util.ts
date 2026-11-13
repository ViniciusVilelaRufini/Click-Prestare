/** Valores de `Ocorrencias.origem` (NULL = registro antigo ou aberto por usuário do app). */
export type OrigemOcorrencia = 'portaria' | 'crm' | 'sistema';

/** "Portaria · João" — o porteiro do console, com o nome quando houver. */
export function rotuloPortaria(nome?: string | null): string {
  const n = (nome ?? '').trim();
  return n ? `Portaria · ${n}` : 'Portaria';
}

/**
 * Autor de exibição de uma ocorrência.
 *
 * `Ocorrencias.user` é opcional — quem abre sem conta em Users grava a
 * `origem`: o porteiro do console ('portaria', com id_funcionario_portaria),
 * o suporte da Prestare pelo CRM ('crm') e o monitor de dispositivos
 * ('sistema'). Sem origem (registro antigo), vale a regra de antes: o nome do
 * usuário; sem ele, "Sistema" para a categoria "Dispositivos" (só o monitor a
 * usa) e "Morador" para o resto.
 *
 * Usado em ocorrencias.service.ts, relatorios.service.ts,
 * dashboard.service.ts e mobile-auth.service.ts (o `criado_por` do app).
 */
export function autorOcorrencia(
  criadoPorNome: string | null | undefined,
  categoriaNome?: string | null,
  origem?: string | null,
  funcionarioPortariaNome?: string | null,
): string {
  if (origem === 'portaria') return rotuloPortaria(funcionarioPortariaNome);
  if (origem === 'crm') return 'Suporte Prestare';
  if (origem === 'sistema') return 'Sistema';
  if (criadoPorNome) return criadoPorNome;
  return categoriaNome === 'Dispositivos' ? 'Sistema' : 'Morador';
}

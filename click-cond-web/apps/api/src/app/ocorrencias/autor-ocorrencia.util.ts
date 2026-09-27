/**
 * Autor de exibição de uma ocorrência.
 *
 * `Ocorrencias.user` é opcional — quando não há usuário vinculado (ex.:
 * ocorrência gerada automaticamente pelo monitoramento de dispositivo,
 * categoria "Dispositivos" — ver facial.service.ts), `criadoPor` vem nulo
 * do Prisma e o front acabava sempre mostrando "Autor: Morador", mesmo para
 * chamados que o sistema abriu sozinho.
 *
 * Não existe (e não foi criada) coluna de origem para essas ocorrências.
 * Como sinal já existente, usamos a categoria "Dispositivos" — usada
 * apenas pelo monitor automático — para decidir entre "Sistema" e o
 * fallback antigo "Morador".
 *
 * Usado em ocorrencias.service.ts, relatorios.service.ts e
 * dashboard.service.ts: os quatro lugares que mapeiam `Ocorrencias` para a
 * tela/relatório/dashboard compartilham essa mesma regra.
 */
export function autorOcorrencia(
  criadoPorNome: string | null | undefined,
  categoriaNome?: string | null,
): string {
  if (criadoPorNome) return criadoPorNome;
  return categoriaNome === 'Dispositivos' ? 'Sistema' : 'Morador';
}

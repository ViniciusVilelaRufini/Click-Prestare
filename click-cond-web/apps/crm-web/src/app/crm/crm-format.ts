import { EstagioCrm, StatusPagamento } from './crm.service';

/**
 * Helpers puros de apresentação do CRM.
 * As classes retornadas usam os tokens semânticos do design system Verdant:
 * variantes prontas de pílula (.badge-*) para rótulos e pares
 * texto/superfície (-soft) para blocos maiores.
 */

export function moeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export function iniciais(nome: string): string {
  return nome
    .split(' ')
    .filter((p) => p.length > 2)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

export function estagioLabel(e: EstagioCrm): string {
  return (
    { lead: 'Lead', trial: 'Trial', ativo: 'Ativo', em_atraso: 'Em atraso', churn: 'Churn' } as Record<EstagioCrm, string>
  )[e];
}

/** Variante de pílula do estágio — usar junto de `.badge`. */
export function estagioClasse(e: EstagioCrm): string {
  return (
    {
      ativo: 'badge-success',
      trial: 'badge-accent',
      lead: 'badge-info',
      em_atraso: 'badge-warning',
      churn: 'badge-danger',
    } as Record<EstagioCrm, string>
  )[e];
}

export function pagamentoLabel(s: StatusPagamento): string {
  return (
    { em_dia: 'Em dia', vencendo: 'Vencendo', atrasado: 'Atrasado', sem_cobranca: 'Sem cobrança' } as Record<StatusPagamento, string>
  )[s];
}

export function pagamentoClasse(s: StatusPagamento): string {
  return (
    {
      em_dia: 'text-success',
      vencendo: 'text-warning',
      atrasado: 'text-danger',
      sem_cobranca: 'text-ink-muted',
    } as Record<StatusPagamento, string>
  )[s];
}

export function riscoLabel(nivel: 'alto' | 'medio' | 'baixo'): string {
  return ({ alto: 'Risco alto', medio: 'Risco médio', baixo: 'Estável' } as Record<string, string>)[nivel];
}

/** Variante de pílula do risco de churn — usar junto de `.badge`. */
export function riscoClasse(nivel: 'alto' | 'medio' | 'baixo'): string {
  return (
    {
      alto: 'badge-danger',
      medio: 'badge-warning',
      baixo: 'badge-success',
    } as Record<string, string>
  )[nivel];
}

export function healthClasse(score: number): string {
  if (score >= 70) return 'text-success';
  if (score >= 40) return 'text-warning';
  return 'text-danger';
}

export function healthBg(score: number): string {
  if (score >= 70) return 'bg-success';
  if (score >= 40) return 'bg-warning';
  return 'bg-danger';
}

export function severidadeClasse(s: 'alta' | 'media' | 'baixa'): string {
  return (
    {
      alta: 'border-danger-border bg-danger-soft',
      media: 'border-warning-border bg-warning-soft',
      baixa: 'border-line bg-surface-sunken',
    } as Record<string, string>
  )[s];
}

export function severidadeDot(s: 'alta' | 'media' | 'baixa'): string {
  return ({ alta: 'bg-danger', media: 'bg-warning', baixa: 'bg-ink-muted' } as Record<string, string>)[s];
}

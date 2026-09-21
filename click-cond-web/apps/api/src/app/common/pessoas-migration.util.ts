/**
 * Migração Visitantes → Pessoas/Visitas: as tabelas `pessoas`/`visitas` estão
 * no schema do Prisma (então `this.prisma.pessoas` SEMPRE existe depois de
 * `prisma generate`, seja qual for o ambiente), mas nem todo ambiente já as
 * populou — checar `this.prisma.pessoas` como "feature flag" testaria a
 * coisa errada: o delegate existe sempre, então o branch novo seria sempre
 * tomado mesmo contra um banco que ainda não tem as tabelas.
 *
 * A flag decide a fonte sozinha — nunca a presença de dados. Default OFF.
 *
 * Lida em cada chamada (não numa const de módulo) de propósito: testes viram
 * a flag em runtime sem precisar recarregar o módulo, e em produção o valor
 * de `process.env` não muda depois do boot mesmo assim.
 *
 * Cópia compartilhada usada pelas leituras migradas nesta rodada
 * (mobile-auth, dashboard, apartamentos, vagas, relatórios). `facial.service.ts`
 * e `visitantes.service.ts` mantêm suas próprias cópias privadas
 * (pré-existentes, não tocadas aqui) — mesma lógica, arquivo diferente.
 */
export function pessoasMigrationEnabled(prisma?: any): boolean {
  if (process.env['PESSOAS_MIGRATION_ENABLED'] !== 'true') return false;
  if (prisma && prisma.visitas === undefined && prisma.pessoas === undefined) return false;
  return true;
}

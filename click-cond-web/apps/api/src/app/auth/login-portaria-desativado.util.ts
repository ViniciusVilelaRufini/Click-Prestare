import { Logger, ServiceUnavailableException } from '@nestjs/common';

const logger = new Logger('LoginPortariaDesativado');

/** Por quanto tempo a resposta fica em cache por (conta, condomínio) — o mesmo prazo do JwtStrategy. */
const CACHE_MS = 30_000;
const cache = new Map<string, { valor: boolean; expira: number }>();

/**
 * Esquece o que está em cache. A aba "Equipe da portaria" chama ao ativar/desativar, para valer na hora nesta
 * instância (as outras esperam até CACHE_MS). Sem argumento, limpa tudo.
 */
export function limparCacheLoginPortariaDesativado(idCondominio?: number) {
  if (idCondominio == null) return cache.clear();
  for (const k of [...cache.keys()]) if (k.endsWith(`:${Number(idCondominio)}`)) cache.delete(k);
}

export const MSG_FUNCIONARIO_DESATIVADO =
  'Seu acesso de funcionário a este condomínio está desativado. Fale com o síndico.';
export const MSG_CONFERENCIA_INDISPONIVEL = 'Não foi possível conferir seu acesso agora. Tente novamente em instantes.';

/**
 * "Login de portaria desativado neste condomínio": a conta Users tem, NESTE condomínio, linha(s) em
 * Funcionarios_Portaria ligadas a ela — `login` ou `email` da linha igual ao login ou ao e-mail da conta (o elo do
 * cadastro do porteiro e o do fallback do loginFuncionario, que liga também pelo e-mail) —, todas com `ativo = 0`, e
 * nenhuma ativa. Uma consulta só (JOIN com Users), com cache de 30 s por (conta, condomínio).
 *
 * O síndico desativa o porteiro na aba "Equipe da portaria" (ativo = 0). O vínculo de equipe do app (Funcionarios)
 * não tem "ativo" — muitos pontos conferem só a existência da linha —, então é este helper que corta, enquanto a
 * linha estiver inativa, o acesso do FUNCIONÁRIO a este condomínio: login do app, rotas do app (TenantAccessService),
 * QR do console (assertVinculoCondominio) e a sessão de console aberta pelo QR (JwtStrategy.vinculoConsoleAtivo).
 * Reativar (ativo = 1) devolve tudo sem recriar nada.
 *
 * Quem NÃO é afetado: o síndico e o morador (os ramos deles nunca chamam isto), a pessoa em OUTRO condomínio (a
 * consulta é por id_condominio) e a conta sem linha de portaria aqui.
 *
 * Erro na consulta: com `falhaFechada` (caminhos de AUTENTICAÇÃO: loginFuncionario e QR) lança 503 e a pessoa tenta
 * de novo; sem ela (rotas: tenant, JwtStrategy) segue o vínculo e registra no log, como o JwtStrategy faz. Erro não
 * fica em cache.
 */
export async function loginPortariaDesativadoNoCondominio(
  db: any,
  idUser: number,
  idCondominio: number,
  opcoes: { falhaFechada?: boolean } = {},
): Promise<boolean> {
  if (!idUser || !idCondominio) return false;
  const chave = `${Number(idUser)}:${Number(idCondominio)}`;
  const agora = Date.now();
  const emCache = cache.get(chave);
  if (emCache && emCache.expira > agora) return emCache.valor;
  let linhas: unknown;
  try {
    linhas = await db.$queryRaw`
      SELECT fp.ativo AS ativo
        FROM Funcionarios_Portaria fp
        JOIN Users u ON u.id = ${Number(idUser)}
       WHERE fp.id_condominio = ${Number(idCondominio)}
         AND (
              (u.login IS NOT NULL AND u.login <> '' AND (fp.login = u.login OR fp.email = u.login))
           OR (u.email IS NOT NULL AND u.email <> '' AND (fp.login = u.email OR fp.email = u.email))
         )`;
    if (!Array.isArray(linhas)) throw new Error('resposta inesperada');
  } catch (e: any) {
    if (opcoes.falhaFechada) {
      logger.warn(`Conferência do login de portaria (conta ${idUser}, condomínio ${idCondominio}) falhou; acesso recusado: ${e?.message ?? e}`);
      throw new ServiceUnavailableException(MSG_CONFERENCIA_INDISPONIVEL);
    }
    logger.warn(`Não foi possível conferir o login de portaria do usuário ${idUser} no condomínio ${idCondominio}: ${e?.message ?? e}`);
    return false;
  }
  const valor = linhas.length > 0 && linhas.every((l: any) => l?.ativo != null && Number(l.ativo) !== 1);
  if (cache.size > 10_000) cache.clear();
  cache.set(chave, { valor, expira: agora + CACHE_MS });
  return valor;
}

import { Logger, ServiceUnavailableException } from '@nestjs/common';

const logger = new Logger('LoginPortariaDesativado');

/** Por quanto tempo a resposta fica em cache por (conta, condomínio) — o mesmo prazo do JwtStrategy. */
const CACHE_MS = 30_000;
/** Resposta e o par login/e-mail da conta com que ela foi calculada. */
const cache = new Map<string, { valor: boolean; chaves: string[]; expira: number }>();

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
 * nenhuma ativa. Duas consultas por parâmetro (a conta por id; as linhas deste condomínio pelos valores dela), com
 * cache de 30 s por (conta, condomínio).
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
  let chaves: string[];
  let linhas: unknown;
  try {
    // Nunca coluna × coluna entre tabelas em SQL (Users e Funcionarios_Portaria podem ter collations diferentes, e a
    // comparação daria erro 1267 em toda chamada): lê os VALORES da conta e consulta as linhas por parâmetro.
    const conta = await db.users.findUnique({ where: { id: Number(idUser) }, select: { login: true, email: true } });
    chaves = [...new Set([conta?.login, conta?.email].map(normalizar).filter((v): v is string => !!v))];
    if (chaves.length === 0) {
      linhas = [];
    } else {
      const valores = [...new Set([conta?.login, conta?.email].filter((v): v is string => typeof v === 'string' && !!v.trim()).flatMap((v) => [v, v.trim()]))];
      linhas = await db.funcionarios_Portaria.findMany({
        where: { id_condominio: Number(idCondominio), OR: [{ login: { in: valores } }, { email: { in: valores } }] },
        select: { login: true, email: true, ativo: true },
      });
    }
    if (!Array.isArray(linhas)) throw new Error('resposta inesperada');
  } catch (e: any) {
    if (opcoes.falhaFechada) {
      logger.warn(`Conferência do login de portaria (conta ${idUser}, condomínio ${idCondominio}) falhou; acesso recusado: ${e?.message ?? e}`);
      throw new ServiceUnavailableException(MSG_CONFERENCIA_INDISPONIVEL);
    }
    logger.warn(`Não foi possível conferir o login de portaria do usuário ${idUser} no condomínio ${idCondominio}: ${e?.message ?? e}`);
    return false;
  }
  // Em memória, em minúsculas dos dois lados (além do que a collation do banco fizer); login/e-mail vazio da linha
  // nunca casa (a conta sem e-mail não casa com linha de e-mail vazio).
  const daConta = new Set(chaves);
  const ligadas = (linhas as any[]).filter((l) => {
    const login = normalizar(l?.login);
    const email = normalizar(l?.email);
    return (!!login && daConta.has(login)) || (!!email && daConta.has(email));
  });
  const valor = ligadas.length > 0 && ligadas.every((l: any) => l?.ativo != null && Number(l.ativo) !== 1);
  if (cache.size > 10_000) cache.clear();
  cache.set(chave, { valor, chaves, expira: agora + CACHE_MS });
  return valor;
}

/** Login/e-mail para comparar: sem espaços nas pontas, minúsculo; vazio vira null. */
function normalizar(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  return t || null;
}

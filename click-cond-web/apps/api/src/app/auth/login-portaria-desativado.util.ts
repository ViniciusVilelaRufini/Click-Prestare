import { Logger } from '@nestjs/common';

const logger = new Logger('LoginPortariaDesativado');

/**
 * "Login de portaria desativado neste condomínio": a conta Users tem, NESTE condomínio, linha(s) em
 * Funcionarios_Portaria cujo `login` é o login ou o e-mail dela — o mesmo elo que o cadastro do porteiro e o
 * fallback do loginFuncionario usam —, todas com `ativo = 0`, e nenhuma ativa.
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
 * `db`: PrismaService ou o cliente de uma transação. Erro na leitura → false (segue o vínculo), com aviso no log: a
 * mesma escolha do JwtStrategy (fail-open) — a consulta do vínculo acabou de funcionar, e um erro aqui não pode
 * derrubar o acesso de toda a equipe.
 */
export async function loginPortariaDesativadoNoCondominio(db: any, idUser: number, idCondominio: number): Promise<boolean> {
  if (!idUser || !idCondominio) return false;
  try {
    const conta = await db.users.findUnique({ where: { id: Number(idUser) }, select: { login: true, email: true } });
    const chaves = [...new Set([conta?.login, conta?.email].filter((s): s is string => typeof s === 'string' && !!s.trim()))];
    if (chaves.length === 0) return false;
    const linhas: { ativo: number }[] | null | undefined = await db.funcionarios_Portaria.findMany({
      where: { id_condominio: Number(idCondominio), login: { in: chaves } },
      select: { ativo: true },
    });
    return Array.isArray(linhas) && linhas.length > 0 && linhas.every((l) => l?.ativo != null && Number(l.ativo) !== 1);
  } catch (e: any) {
    logger.warn(`Não foi possível conferir o login de portaria do usuário ${idUser} no condomínio ${idCondominio}: ${e?.message ?? e}`);
    return false;
  }
}

export const MSG_FUNCIONARIO_DESATIVADO =
  'Seu acesso de funcionário a este condomínio está desativado. Fale com o síndico.';

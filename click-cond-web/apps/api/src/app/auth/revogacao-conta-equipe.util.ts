import { randomBytes } from 'crypto';
import { DOMINIO_CONTA_REVOGADA } from '../common/email-reservado.util';
import { momentoTrocaSenha } from './senha-alterada.util';
import { contaSoDaEquipeDoCondominio } from './conta-so-de-equipe.util';

/**
 * Rotina única de "tirar uma conta do app da equipe de um condomínio", usada dentro de uma transação por quem
 * revoga ou move um login de portaria: o cadastro de prestador (PrestadoresService) e a troca de e-mail do
 * funcionário pelo app do síndico (MobileAuthService.saveFuncionario).
 *
 * - A conta é achada pelo login de portaria (login OU e-mail; vale a que é da equipe deste condomínio e, sem ela, a
 *   mais antiga). Conta que não é da equipe daqui não é nossa: nada é tocado.
 * - Sai o vínculo Funcionarios DESTE condomínio (os de outros prédios ficam).
 * - Conta EXCLUSIVAMENTE desta equipe (sem papel de síndico, morador nem equipe em outro prédio): lápide em login e
 *   e-mail, CPF liberado, senha inutilizável e senha_alterada_em — ela não autentica mais e o e-mail fica livre.
 * - Conta compartilhada: só senha_alterada_em (os tokens caem). E-mail e senha intactos.
 * - NUNCA apaga Users.
 */

/** Valor-lápide aleatório (~70 caracteres, domínio `.invalid` reservado e recusado em todo cadastro). */
export function novaLapidePadrao(idUser: number): string {
  return `revogado-${idUser}-${randomBytes(16).toString('hex')}@${DOMINIO_CONTA_REVOGADA}`;
}

/** Não começa com `$2` (não é bcrypt) e não é hexadecimal (nunca coincide com md5 legado). */
export function senhaInutilizavel(idUser: number) {
  return `!revogado:${idUser}`;
}

/** A conta do app ligada a um login de portaria (login OU e-mail): a da equipe deste condomínio, senão a mais antiga. */
export async function contaDoLoginNaEquipe(db: any, login: string, idCondominio: number) {
  const porLogin = { OR: [{ login }, { email: login }] };
  return (
    (await db.users.findFirst({
      where: { ...porLogin, funcionarios: { some: { id_condominio: Number(idCondominio) } } },
      orderBy: { id: 'asc' },
    })) ?? (await db.users.findFirst({ where: porLogin, orderBy: { id: 'asc' } }))
  );
}

/** A conta é da equipe deste condomínio (`daqui`) e exclusivamente dela (`soDaqui`, com as flags como trava extra). */
export async function contaSoDestaEquipe(
  db: any,
  conta: { id: number; is_sindico?: number | null; is_morador?: number | null },
  idCondominio: number,
) {
  const daqui = await db.funcionarios.findFirst({
    where: { id_user: conta.id, id_condominio: Number(idCondominio) },
    select: { id: true },
  });
  const soDaqui = !!daqui && !conta.is_sindico && !conta.is_morador && (await contaSoDaEquipeDoCondominio(db, conta.id, idCondominio));
  return { daqui: !!daqui, soDaqui };
}

export interface OpcoesRevogacao {
  /** Gerador da lápide (o spec do cadastro de prestador simula lápide ocupada). */
  novaLapide?: (idUser: number) => string;
  logger?: { warn(msg: string): void };
  /** Conta que nunca é tocada (a do próprio síndico que faz a troca: a sessão dele prova a posse). */
  pularConta?: number | null;
}

/**
 * Inutiliza a conta que era só desta equipe. A lápide nunca derruba a revogação: já ocupada (de antemão ou por
 * corrida no @unique), tenta outra; depois de 3, segue sem ela (e-mail ocupado, mas sem senha que entre e sem tokens).
 */
export async function inutilizarConta(tx: any, idUser: number, opcoes: OpcoesRevogacao = {}) {
  const base = { password: senhaInutilizavel(idUser), senha_alterada_em: momentoTrocaSenha(), cpf: null };
  const gerar = opcoes.novaLapide ?? novaLapidePadrao;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const lapide = gerar(idUser);
    const ocupada = await tx.users.findFirst({
      where: { OR: [{ login: lapide }, { email: lapide }], NOT: { id: idUser } },
      select: { id: true },
    });
    if (ocupada) continue;
    try {
      await tx.users.update({ where: { id: idUser }, data: { ...base, login: lapide, email: lapide } });
      return;
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
    }
  }
  opcoes.logger?.warn(`Lápide indisponível para a conta ${idUser}: revogada sem liberar o e-mail.`);
  await tx.users.update({ where: { id: idUser }, data: base });
}

/**
 * Tira da equipe deste condomínio a conta ligada a `login` (regras no topo do arquivo). Rode DENTRO da transação de
 * quem chama: a conta é relida e a checagem "exclusivamente desta equipe" refeita nela. Devolve o vínculo
 * Funcionarios removido (para a conta nova herdar as permissões), ou null.
 */
export async function tirarContaDaEquipe(
  tx: any,
  login: string,
  idCondominio: number,
  opcoes: OpcoesRevogacao = {},
): Promise<Record<string, any> | null> {
  const conta = await contaDoLoginNaEquipe(tx, login, idCondominio);
  if (!conta || (opcoes.pularConta != null && conta.id === opcoes.pularConta)) return null;
  const { daqui, soDaqui } = await contaSoDestaEquipe(tx, conta, idCondominio);
  if (!daqui) return null;
  const vinculo = await tx.funcionarios.findFirst({ where: { id_user: conta.id, id_condominio: Number(idCondominio) } });
  await tx.funcionarios.deleteMany({ where: { id_user: conta.id, id_condominio: Number(idCondominio) } });
  if (soDaqui) await inutilizarConta(tx, conta.id, opcoes);
  else await tx.users.update({ where: { id: conta.id }, data: { senha_alterada_em: momentoTrocaSenha() } });
  return vinculo;
}

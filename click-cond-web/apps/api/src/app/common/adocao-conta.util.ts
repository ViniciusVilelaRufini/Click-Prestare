import { momentoTrocaSenha } from '../auth/senha-alterada.util';

/**
 * Adoção de conta existente (Users) nos pontos de cadastro — moradores (console, importação, CRM),
 * morador/familiar pelo app e "Vincular síndico" do CRM.
 *
 * `POST /sindico/signup` é público e grava e-mail, CPF e senha sem provar a posse do e-mail. Ligar um
 * cadastro a uma conta dessas entregava a unidade (QR do portão, passe da carteira, portaria remota) ou
 * o papel de síndico a quem criou a conta antes do dono. Regra única:
 * - conta achada SÓ pelo CPF não é adotada (o CPF não é segredo);
 * - conta "órfã autocriada" (tem senha, nenhum vínculo em condomínio nenhum, não é a do solicitante) só é
 *   adotada depois de invalidar a posse anterior: senha nova aleatória enviada ao e-mail da conta,
 *   `senha_alterada_em` (o JwtStrategy recusa os tokens anteriores) e credenciais de acesso revogadas.
 *   Assim só quem controla o e-mail entra.
 */

/** Recusa da conta achada só pelo CPF. Não diz de quem é a conta nem qual e-mail ela usa. */
export const MSG_CONTA_SO_POR_CPF =
  'Já existe uma conta com este CPF. Use o e-mail da conta existente ou fale com o suporte.';

type ContaComEmail = { email?: string | null; login?: string | null };

const norm = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase();

/**
 * A conta casa com o e-mail do cadastro (pelo e-mail ou, conta antiga, pelo login). Sem isso ela só pode
 * ter sido achada pelo CPF.
 */
export function contaCasaComEmail(conta: ContaComEmail, emailCadastro: string | null | undefined): boolean {
  const e = norm(emailCadastro);
  if (!e) return false;
  return norm(conta.email) === e || norm(conta.login) === e;
}

type PrismaVinculos = {
  sindicos_Condominios: { count: (a: any) => Promise<number> };
  funcionarios: { count: (a: any) => Promise<number> };
  moradores: { count: (a: any) => Promise<number> };
  apartamentos_Users: { count: (a: any) => Promise<number> };
};

/**
 * Conta com senha, sem vínculo nenhum (síndico de condomínio, equipe, morador ou unidade) em condomínio
 * nenhum e que não é a do solicitante: o perfil que o /sindico/signup deixa. A senha vem primeiro para não
 * consultar vínculos de conta que nunca autenticou (dependente, cadastro sem acesso ao app).
 */
export async function contaOrfaAutocriada(
  prisma: PrismaVinculos,
  conta: { id: number; password?: string | null },
  idSolicitante: number | null | undefined,
): Promise<boolean> {
  if (!conta.password) return false;
  if (idSolicitante != null && conta.id === idSolicitante) return false;
  const where = { id_user: conta.id };
  const [s, f, m, a] = await Promise.all([
    prisma.sindicos_Condominios.count({ where }),
    prisma.funcionarios.count({ where }),
    prisma.moradores.count({ where }),
    prisma.apartamentos_Users.count({ where }),
  ]);
  return s + f + m + a === 0;
}

type PrismaInvalidacao = {
  users: { update: (a: any) => Promise<any> };
  moradores: { findMany: (a: any) => Promise<Array<{ id: number }>> };
  credenciais_Acesso: { updateMany: (a: any) => Promise<any> };
};

/**
 * Invalida a posse anterior da conta antes de adotá-la: grava a senha nova (o hash que o chamador manda ao
 * e-mail da conta) com `senha_alterada_em` — junto com `dadosExtras`, numa escrita só — e revoga as
 * credenciais de acesso ativas das linhas de Moradores da conta. Quem chama envia a senha ao e-mail.
 */
export async function invalidarPosseDaConta(
  tx: PrismaInvalidacao,
  idUser: number,
  senhaHash: string,
  dadosExtras: Record<string, unknown> = {},
  agora: Date = new Date(),
): Promise<void> {
  await tx.users.update({
    where: { id: idUser },
    data: { ...dadosExtras, password: senhaHash, senha_alterada_em: momentoTrocaSenha(agora.getTime()) },
  });
  const linhas = await tx.moradores.findMany({ where: { id_user: idUser }, select: { id: true } });
  await tx.credenciais_Acesso.updateMany({
    where: { tipo_pessoa: 'morador', id_pessoa: { in: linhas.map((l) => l.id) }, revogada_em: null },
    data: { revogada_em: agora },
  });
}

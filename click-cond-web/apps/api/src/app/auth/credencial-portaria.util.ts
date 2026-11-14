import { createHash } from 'crypto';

/**
 * Carimbo da credencial de um login de portaria (Funcionarios_Portaria): hash curto de login + hash da senha.
 * Vai no token do porteiro (`cred`) e o JwtStrategy o compara com a linha atual. Trocar o e-mail (login) ou a
 * senha mantém o mesmo id — e a autoria de ocorrências e mensagens —, mas derruba as sessões abertas com a
 * credencial anterior, sem coluna nova. Nome, telefone e turno não entram: editá-los não desloga ninguém.
 * Não revela nada útil: é sha256 de um hash bcrypt (com sal), cortado.
 */
export function carimboCredencialPortaria(fp: { login: string; password: string }): string {
  const login = String(fp.login ?? '').trim().toLowerCase();
  return createHash('sha256').update(`${login}\n${fp.password ?? ''}`).digest('base64url').slice(0, 22);
}

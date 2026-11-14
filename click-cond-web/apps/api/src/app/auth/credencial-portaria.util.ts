import { createHmac } from 'crypto';
import { resolveJwtSecret } from './jwt-secret';

/**
 * Carimbo da credencial de um login de portaria (Funcionarios_Portaria): HMAC-SHA256, com o segredo do JWT, de
 * login + hash da senha, cortado. Vai no token do porteiro (`cred`) e o JwtStrategy o compara com a linha atual.
 * Trocar o e-mail (login) ou a senha mantém o mesmo id — e a autoria de ocorrências e mensagens —, mas derruba as
 * sessões abertas com a credencial anterior, sem coluna nova. Nome, telefone e turno não entram: editá-los não
 * desloga ninguém. Com HMAC, o carimbo que aparece no token não serve para testar senhas fora do servidor, nem
 * quando a linha ainda guarda um md5 legado.
 */
export function carimboCredencialPortaria(fp: { login: string; password: string }): string {
  const login = String(fp.login ?? '').trim().toLowerCase();
  return createHmac('sha256', resolveJwtSecret()).update(`${login}\n${fp.password ?? ''}`).digest('base64url').slice(0, 22);
}

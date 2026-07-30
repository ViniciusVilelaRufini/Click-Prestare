import * as fs from 'fs';
import * as path from 'path';

/**
 * Senha nova SEMPRE em bcrypt.
 *
 * Os fluxos de login já faziam a migração certa: se o hash guardado é MD5 e a
 * senha bate, re-gravam em bcrypt no mesmo acesso. O que estava invertido era
 * o outro lado — cadastro de morador, cadastro de porteiro, reenvio de
 * credenciais e recuperação de senha ainda GRAVAVAM MD5. Então cada conta
 * nova nascia com hash sem sal e só era promovida no primeiro login.
 *
 * O agravante é o valor: a senha inicial são os dígitos do documento. MD5 sem
 * sal de um número de 11 dígitos cai por força bruta em segundos, então um
 * vazamento do banco entregaria a senha de todo mundo de uma vez.
 *
 * Este teste lê os fontes porque a regra é sobre o CÓDIGO, não sobre uma
 * chamada isolada: um `createHash('md5')` novo perto de um `password:` volta
 * a criar o problema em qualquer lugar do módulo.
 */
describe('Nenhum caminho grava senha em MD5', () => {
  const raiz = path.join(__dirname, '..');

  /** Fontes onde senha é escrita. */
  const arquivos = [
    'auth/auth.service.ts',
    'auth/mobile-auth.service.ts',
    'moradores/moradores.service.ts',
    'prestadores/prestadores.service.ts',
  ];

  it.each(arquivos)('%s não atribui hash MD5 a password', (rel) => {
    const src = fs.readFileSync(path.join(raiz, rel), 'utf8');

    // Variáveis derivadas de MD5 que acabam atribuídas a `password`.
    const declaracoesMd5 = [...src.matchAll(/const\s+(\w+)\s*=\s*(?:await\s+)?[\w.]*createHash\('md5'\)/g)]
      .map((m) => m[1]);

    for (const nome of declaracoesMd5) {
      const atribuido = new RegExp(`password:\\s*${nome}\\b|\\.password\\s*=\\s*${nome}\\b`);
      expect(src).not.toMatch(atribuido);
    }

    // E nenhuma atribuição inline.
    expect(src).not.toMatch(/password:\s*[\w.]*createHash\('md5'\)/);
  });

  it('a verificação de hash legado continua existindo (senão ninguém entra)', () => {
    const auth = fs.readFileSync(path.join(raiz, 'auth/auth.service.ts'), 'utf8');
    const mobile = fs.readFileSync(path.join(raiz, 'auth/mobile-auth.service.ts'), 'utf8');
    // Compara MD5 para aceitar a senha antiga...
    expect(auth).toMatch(/createHash\('md5'\)/);
    expect(mobile).toMatch(/createHash\('md5'\)/);
    // ...e promove para bcrypt no mesmo acesso.
    expect(auth).toMatch(/bcrypt\.hash/);
    expect(mobile).toMatch(/bcrypt\.hash/);
  });
});

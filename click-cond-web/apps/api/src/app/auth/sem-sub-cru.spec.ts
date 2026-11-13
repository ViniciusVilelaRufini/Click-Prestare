import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

/**
 * Estes módulos atendem o porteiro do console (fora do UsuarioAppGuard). Nele o `sub` é
 * Funcionarios_Portaria.id: lido como Users.id, atribui registros a outra pessoa. O id do usuário
 * sai de idUsuarioDoToken / autorDoToken (auth/usuario-do-token.util.ts) — nunca de `.sub`.
 * O chat-ia fica atrás do UsuarioAppGuard, mas grava e executa ações como Users.id: mesma regra.
 */
const MODULOS = ['encomendas', 'areas-sociais', 'delivery', 'consentimentos', 'visitantes', 'chat-ia'];
const LEITURA_CRUA = /\.sub\b|\[\s*['"]sub['"]\s*\]/;
const APP = join(__dirname, '..');

function fontes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return fontes(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('Sem leitura crua de payload.sub como Users.id', () => {
  it.each(MODULOS)('%s', (modulo) => {
    const achados = fontes(join(APP, modulo)).flatMap((arq) =>
      readFileSync(arq, 'utf8')
        .split(/\r?\n/)
        .map((linha, i) => ({ linha, n: i + 1 }))
        .filter(({ linha }) => !/^\s*(\/\/|\*|\/\*)/.test(linha) && LEITURA_CRUA.test(linha))
        .map(({ linha, n }) => `${relative(APP, arq)}:${n}: ${linha.trim()}`),
    );
    expect(achados).toEqual([]);
  });
});

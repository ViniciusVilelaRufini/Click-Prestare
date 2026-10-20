import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Os ticks de manutenção (expiração de visitantes, retry do facial, cobrança,
 * lembretes de reserva…) nascem nos construtores dos serviços com
 * setTimeout/setInterval soltos. Sem `unref()`, cada spec que instancia um
 * desses serviços deixa timers vivos — e quando o Jest roda com um worker só
 * (runner de 2 vCPUs do GitHub em repositório privado) o processo nunca
 * termina: o CI ficou 35 min parado depois de "Ran all test suites" e segurou
 * o deploy, que divide o grupo de concorrência com ele.
 *
 * Em produção nada muda: quem mantém o processo vivo é o servidor HTTP.
 */
const RAIZ = join(__dirname, '..');

function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      return nome === 'generated' ? [] : arquivosTs(caminho);
    }
    return nome.endsWith('.ts') && !nome.endsWith('.spec.ts') ? [caminho] : [];
  });
}

/** Índice do `)` que fecha o `(` em `inicio`. */
function fechamento(src: string, inicio: number): number {
  let nivel = 0;
  for (let i = inicio; i < src.length; i++) {
    if (src[i] === '(') nivel++;
    else if (src[i] === ')' && --nivel === 0) return i;
  }
  return -1;
}

describe('timers de manutenção não seguram o processo', () => {
  it('todo setTimeout/setInterval solto (instrução própria) chama unref()', () => {
    const semUnref: string[] = [];
    for (const arquivo of arquivosTs(RAIZ)) {
      const src = readFileSync(arquivo, 'utf8');
      const instrucao = /^[ \t]*(setInterval|setTimeout)\(/gm;
      let m: RegExpExecArray | null;
      while ((m = instrucao.exec(src))) {
        const abre = m.index + m[0].length - 1;
        const fecha = fechamento(src, abre);
        const depois = src.slice(fecha + 1, fecha + 12);
        if (!/^\s*\.unref/.test(depois)) {
          const linha = src.slice(0, m.index).split('\n').length;
          semUnref.push(`${relative(RAIZ, arquivo)}:${linha}`);
        }
      }
    }
    expect(semUnref).toEqual([]);
  });
});

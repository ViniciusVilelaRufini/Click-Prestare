import { unidadeGuaritaDoTexto } from './guarita-comum.util';

/**
 * I4: texto livre de unidade/bloco → (unidade, byte do bloco) do Guarita, de
 * forma ESTRITA. O que não for inequívoco não grava.
 */
describe('unidadeGuaritaDoTexto', () => {
  it.each([
    // [bloco, apto, condomínio sem blocos, unidade, byte do bloco]
    ['A', '101', false, 101, 0x00],
    ['b', '0308', false, 308, 0x01],
    ['Bloco C', '12', false, 12, 0x02],
    ['Torre 2', '101', false, 101, 0x1b],
    ['Bl 7', '9999', false, 9999, 0x20],
    ['bl. Z', '1', false, 1, 0x19],
    ['230', '5', false, 5, 0xff],
    ['01', '5', false, 5, 0x1a],
    ['', '101', true, 101, 0x00],
    [null, ' 1 0 1 ', true, 101, 0x00],
    ['  ', '0', true, 0, 0x00],
  ])('bloco %p, apto %p (sem blocos: %p) → %i / 0x%s', (bloco, apto, semBlocos, unidade, byte) => {
    expect(unidadeGuaritaDoTexto(bloco as any, apto as any, semBlocos as boolean)).toEqual({ ok: true, unidade, bloco: byte });
  });

  it.each([
    ['A', '101A'],
    ['A', 'Apto 308'],
    ['A', 'Torre 2 Apto 101'],
    ['A', '308 Bloco 2'],
    ['A', '10000'],
    ['A', ''],
    ['A', null],
    ['AA', '101'],
    ['231', '101'],
    ['0', '101'],
    ['Torre Norte', '101'],
    ['B1', '101'],
    ['Bloco', '101'],
  ])('bloco %p, apto %p → não grava', (bloco, apto) => {
    const r = unidadeGuaritaDoTexto(bloco as any, apto as any, false);
    expect(r.ok).toBe(false);
    expect((r as any).erro).toMatch(/^A unidade '.*' não tem número compatível com o Guarita\.$/);
  });

  it('bloco vazio só vira A quando o condomínio inteiro não tem bloco', () => {
    expect(unidadeGuaritaDoTexto('', '101', false).ok).toBe(false);
    expect(unidadeGuaritaDoTexto('', '101', true)).toEqual({ ok: true, unidade: 101, bloco: 0 });
  });

  it('a mensagem traz o texto da unidade como está no cadastro', () => {
    expect(unidadeGuaritaDoTexto('Torre 2', '101A', false)).toEqual({
      ok: false,
      erro: "A unidade 'Torre 2 / 101A' não tem número compatível com o Guarita.",
    });
  });
});

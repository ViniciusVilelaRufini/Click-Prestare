import { UnidadeLabelPipe } from './unidade-label.pipe';

describe('UnidadeLabelPipe', () => {
  const p = new UnidadeLabelPipe();
  it('formata "Bloco A · Apto 101"', () => {
    expect(p.transform('101', 'A')).toBe('Bloco A · Apto 101');
    expect(p.transform('101', 'Bloco A')).toBe('Bloco A · Apto 101');
  });
  it('sem bloco ou com "Apto" já no número', () => {
    expect(p.transform('101', null)).toBe('Apto 101');
    expect(p.transform('Apto 101', 'B')).toBe('Bloco B · Apto 101');
    expect(p.transform(null, null)).toBe('');
  });
});

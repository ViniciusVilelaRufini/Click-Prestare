import { formatarApto } from './formatar-apto.util';

describe('formatarApto', () => {
  it('should return empty string when both apto and bloco are empty', () => {
    expect(formatarApto('', '')).toBe('');
    expect(formatarApto('', null)).toBe('');
    expect(formatarApto(null, '')).toBe('');
    expect(formatarApto(null, null)).toBe('');
  });

  it('should return just the apartment when bloco is empty', () => {
    expect(formatarApto('108', '')).toBe('Apto 108');
    expect(formatarApto('108', null)).toBe('Apto 108');
  });

  it('should return bloco with "Bloco" prefix when apto is empty', () => {
    expect(formatarApto('', 'A')).toBe('Bloco A');
    expect(formatarApto(null, 'A')).toBe('Bloco A');
    expect(formatarApto('', 'Bloco A')).toBe('Bloco A');
  });

  it('should not double-prefix bloco that already starts with "Bloco" (case-insensitive)', () => {
    expect(formatarApto('108', 'Bloco A')).toBe('Bloco A · Apto 108');
    expect(formatarApto('108', 'BLOCO A')).toBe('BLOCO A · Apto 108');
    expect(formatarApto('108', 'bloco A')).toBe('bloco A · Apto 108');
  });

  it('should prefix short bloco (single letter) with "Bloco " when apto is present', () => {
    expect(formatarApto('108', 'A')).toBe('Bloco A · Apto 108');
    expect(formatarApto('108', 'B')).toBe('Bloco B · Apto 108');
  });

  it('should prefix other bloco values that do not start with "Bloco"', () => {
    expect(formatarApto('108', 'Fundos')).toBe('Bloco Fundos · Apto 108');
    expect(formatarApto('108', 'Frente')).toBe('Bloco Frente · Apto 108');
  });

  it('should trim whitespace', () => {
    expect(formatarApto('  108  ', '  Bloco A  ')).toBe('Bloco A · Apto 108');
    expect(formatarApto('  108  ', '  A  ')).toBe('Bloco A · Apto 108');
  });

  it('should use word-boundary check: "Bloco" matches, "Blocos" does not', () => {
    expect(formatarApto('108', 'Blocos')).toBe('Bloco Blocos · Apto 108');
    expect(formatarApto('108', 'Bloco')).toBe('Bloco · Apto 108');
  });
});

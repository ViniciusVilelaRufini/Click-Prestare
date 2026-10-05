import { formatarApto } from './formatar-apto.util';

describe('formatarApto', () => {
  it('should return empty string when both apto and bloco are empty', () => {
    expect(formatarApto('', '')).toBe('');
    expect(formatarApto('', null as any)).toBe('');
    expect(formatarApto(null as any, '')).toBe('');
    expect(formatarApto(null as any, null as any)).toBe('');
  });

  it('should return just the apartment when bloco is empty', () => {
    expect(formatarApto('108', '')).toBe('Apto 108');
    expect(formatarApto('108', null as any)).toBe('Apto 108');
  });

  it('should return just the bloco when apto is empty', () => {
    expect(formatarApto('', 'Bloco A')).toBe('Bloco A');
    expect(formatarApto(null as any, 'Bloco A')).toBe('Bloco A');
  });

  it('should format with middle dot separator when bloco starts with "Bloco" (case-insensitive)', () => {
    expect(formatarApto('108', 'Bloco A')).toBe('Apto 108 · Bloco A');
    expect(formatarApto('108', 'BLOCO A')).toBe('Apto 108 · BLOCO A');
    expect(formatarApto('108', 'bloco A')).toBe('Apto 108 · bloco A');
    expect(formatarApto('108', 'Bloco A')).toBe('Apto 108 · Bloco A');
  });

  it('should format with middle dot separator when bloco is short (just letter)', () => {
    expect(formatarApto('108', 'A')).toBe('Apto 108 · A');
    expect(formatarApto('108', 'B')).toBe('Apto 108 · B');
  });

  it('should trim whitespace', () => {
    expect(formatarApto('  108  ', '  Bloco A  ')).toBe('Apto 108 · Bloco A');
    expect(formatarApto('  108  ', '  A  ')).toBe('Apto 108 · A');
  });

  it('should handle edge cases with arbitrary bloco values', () => {
    expect(formatarApto('108', 'Fundos')).toBe('Apto 108 · Fundos');
    expect(formatarApto('108', 'Apto Fundos')).toBe('Apto 108 · Apto Fundos');
  });
});

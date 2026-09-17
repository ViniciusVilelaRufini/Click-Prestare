import { BadRequestException } from '@nestjs/common';
import { calcularIdade, validarMaioridade } from './idade.util';

describe('idade.util', () => {
  it('calcula idade corretamente para maior de 18', () => {
    const vinteAnosAtras = new Date();
    vinteAnosAtras.setFullYear(vinteAnosAtras.getFullYear() - 20);
    expect(calcularIdade(vinteAnosAtras)).toBe(20);
    expect(() => validarMaioridade(vinteAnosAtras)).not.toThrow();
  });

  it('calcula idade corretamente para menor de 18', () => {
    const dezAnosAtras = new Date();
    dezAnosAtras.setFullYear(dezAnosAtras.getFullYear() - 10);
    expect(calcularIdade(dezAnosAtras)).toBe(10);
    expect(() => validarMaioridade(dezAnosAtras, 'biometria')).toThrow(BadRequestException);
  });

  it('lida com aniversariante do dia e dia seguinte', () => {
    const hoje = new Date();
    const fez18Hoje = new Date(hoje.getFullYear() - 18, hoje.getMonth(), hoje.getDate());
    expect(calcularIdade(fez18Hoje)).toBe(18);
    expect(() => validarMaioridade(fez18Hoje)).not.toThrow();

    const faz18Amanha = new Date(hoje.getFullYear() - 18, hoje.getMonth(), hoje.getDate() + 1);
    expect(calcularIdade(faz18Amanha)).toBe(17);
    expect(() => validarMaioridade(faz18Amanha)).toThrow(BadRequestException);
  });

  it('suporta strings nos formatos YYYY-MM-DD e DD/MM/YYYY', () => {
    const vinteAnos = new Date();
    vinteAnos.setFullYear(vinteAnos.getFullYear() - 20);
    const ano = vinteAnos.getFullYear();
    const mes = String(vinteAnos.getMonth() + 1).padStart(2, '0');
    const dia = String(vinteAnos.getDate()).padStart(2, '0');

    expect(calcularIdade(`${ano}-${mes}-${dia}`)).toBe(20);
    expect(calcularIdade(`${dia}/${mes}/${ano}`)).toBe(20);
  });

  it('lança BadRequestException se data de nascimento for ausente ou inválida', () => {
    expect(() => validarMaioridade(null)).toThrow(BadRequestException);
    expect(() => validarMaioridade('')).toThrow(BadRequestException);
    expect(() => validarMaioridade('data-invalida')).toThrow(BadRequestException);
  });
});

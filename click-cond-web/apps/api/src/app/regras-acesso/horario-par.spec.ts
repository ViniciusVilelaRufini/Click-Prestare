import { BadRequestException } from '@nestjs/common';
import { assertParHorario } from './regras-acesso.service';

describe('assertParHorario', () => {
  it('aceita os dois ou nenhum', () => {
    expect(() => assertParHorario('08:00', '18:00')).not.toThrow();
    expect(() => assertParHorario(null, null)).not.toThrow();
    expect(() => assertParHorario('', undefined)).not.toThrow();
  });
  it('recusa so um dos dois', () => {
    expect(() => assertParHorario('08:00', null)).toThrow(BadRequestException);
    expect(() => assertParHorario(undefined, '18:00')).toThrow(BadRequestException);
  });
});

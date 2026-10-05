import { ForbiddenException } from '@nestjs/common';
import { assertSindicoEstrito } from './tenant.util';

describe('assertSindicoEstrito', () => {
  it('aceita typeAccess Sindico, em qualquer caixa e também aninhado em user', () => {
    expect(() => assertSindicoEstrito({ sub: 1, typeAccess: 'Sindico' } as any, 'x')).not.toThrow();
    expect(() => assertSindicoEstrito({ sub: 1, typeAccess: 'SINDICO' } as any, 'x')).not.toThrow();
    expect(() => assertSindicoEstrito({ sub: 1, user: { typeAccess: 'sindico' } } as any, 'x')).not.toThrow();
  });

  it('recusa porteiro sem typeAccess, com mensagem em português', () => {
    const porteiro = { sub: 2, nome: 'P', id_condominio: 1, turno: 'Diurno' } as any;
    expect(() => assertSindicoEstrito(porteiro, 'remover terminal')).toThrow(ForbiddenException);
    expect(() => assertSindicoEstrito(porteiro, 'remover terminal')).toThrow(
      'Acesso negado: remover terminal exige síndico.',
    );
  });

  it('recusa funcionário, morador, usuário ausente e turno "Síndico" sem typeAccess', () => {
    expect(() => assertSindicoEstrito({ typeAccess: 'Funcionario' } as any)).toThrow(ForbiddenException);
    expect(() => assertSindicoEstrito({ typeAccess: 'Morador' } as any)).toThrow(ForbiddenException);
    expect(() => assertSindicoEstrito(undefined)).toThrow(ForbiddenException);
    // turno é texto livre de Funcionarios_Portaria: não pode valer como prova de papel.
    expect(() => assertSindicoEstrito({ id_condominio: 1, turno: 'Síndico' } as any)).toThrow(ForbiddenException);
  });
});

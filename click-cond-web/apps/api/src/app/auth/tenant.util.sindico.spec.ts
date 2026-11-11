import { ForbiddenException } from '@nestjs/common';
import { assertSindico, assertSindicoEstrito, isSindico } from './tenant.util';

/** Versão booleana de assertSindico: tem que decidir igual, caso a caso. */
describe('isSindico', () => {
  const casos: Array<[string, any]> = [
    ['síndico do app', { sub: 1, typeAccess: 'Sindico' }],
    ['síndico aninhado em user', { sub: 1, user: { typeAccess: 'Sindico' } }],
    ['console com turno Síndico', { sub: 1, id_condominio: 1, turno: 'Síndico' }],
    ['porteiro do console', { sub: 2, id_condominio: 1, turno: 'Diurno' }],
    ['funcionário', { sub: 3, typeAccess: 'Funcionario' }],
    ['morador', { sub: 4, typeAccess: 'Morador' }],
    ['typeAccess em outra caixa', { sub: 5, typeAccess: 'sindico' }],
    ['ausente', undefined],
  ];

  it.each(casos)('%s: mesmo veredito de assertSindico', (_nome, user) => {
    let passa = true;
    try {
      assertSindico(user, 'x');
    } catch {
      passa = false;
    }
    expect(isSindico(user)).toBe(passa);
  });

  it('aceita síndico e recusa porteiro', () => {
    expect(isSindico({ sub: 1, typeAccess: 'Sindico' } as any)).toBe(true);
    expect(isSindico({ sub: 2, id_condominio: 1, turno: 'Diurno' } as any)).toBe(false);
  });
});

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

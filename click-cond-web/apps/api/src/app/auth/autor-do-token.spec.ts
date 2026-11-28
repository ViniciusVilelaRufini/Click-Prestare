import { autorDoToken } from './usuario-do-token.util';

/** De qual tabela é o id de quem fez a ação — gravado em audit_logs.autor_id/autor_tipo. */
describe('autorDoToken', () => {
  it('porteiro do console → Funcionarios_Portaria', () => {
    expect(autorDoToken({ sub: 3, nome: 'P', id_condominio: 7, tipo_sub: 'funcionario_portaria' })).toEqual({
      autor_id: 3,
      autor_tipo: 'funcionario_portaria',
    });
  });

  it.each(['Sindico', 'Morador', 'Funcionario'])('token de usuário (%s) → Users', (typeAccess) => {
    expect(autorDoToken({ sub: 42, nome: 'U', typeAccess })).toEqual({ autor_id: 42, autor_tipo: 'user' });
  });

  it('operador do CRM → crm_admins', () => {
    expect(autorDoToken({ sub: 5, nome: 'Admin', role: 'crm_admin' })).toEqual({ autor_id: 5, autor_tipo: 'crm_admin' });
  });

  it('CRM vence mesmo se o token trouxer typeAccess', () => {
    expect(autorDoToken({ sub: 5, nome: 'Admin', role: 'crm_admin', typeAccess: 'Sindico' })).toEqual({
      autor_id: 5,
      autor_tipo: 'crm_admin',
    });
  });

  it('operador da central → Central_Operadores', () => {
    expect(autorDoToken({ sub: 5, nome: 'Olga', papel: 'operador_central' } as any)).toEqual({
      autor_id: 5,
      autor_tipo: 'operador_central',
    });
  });

  it('papel de operador misturado com marca de outro token → nada', () => {
    expect(autorDoToken({ sub: 5, nome: 'X', papel: 'operador_central', tipo_sub: 'funcionario_portaria' } as any)).toEqual({
      autor_id: null,
      autor_tipo: null,
    });
  });

  it('sem token → sistema, sem id', () => {
    expect(autorDoToken(undefined)).toEqual({ autor_id: null, autor_tipo: 'sistema' });
  });

  it('forma não reconhecida → nada (não infere a tabela pela forma do token)', () => {
    expect(autorDoToken({ sub: 3, nome: 'X', id_condominio: 7 })).toEqual({ autor_id: null, autor_tipo: null });
  });
});

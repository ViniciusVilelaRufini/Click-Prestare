import { Logger } from '@nestjs/common';
import { criarBancoFalso } from './guarita-banco-falso.testutil';
import { GuaritaOperacoesService } from './guarita-operacoes.service';
import { ApartamentosService } from '../apartamentos/apartamentos.service';
import { MobileAuthService } from '../auth/mobile-auth.service';

/** I7: saídas de morador que não estavam cobertas. */

function montar(guaritaAtivo = 1) {
  const db = criarBancoFalso();
  db.semear('facial_Devices', [{ id: 10, id_condominio: 7, nome: 'Guarita', tipo: 'guarita', fabricante: 'linear', ativo: guaritaAtivo }]);
  db.semear('guarita_Backups', [{ id_condominio: 7, id_device: 10, motivo: 'importacao', total: 0, dados: '[]' }]);
  db.semear('apartamentos', [{ id: 1, id_condominio: 7, bloco: 'B', apto: '308' }]);
  db.semear('apartamentos_Users', [{ id: 1, id_apto: 1, id_user: 500 }]);
  db.semear('moradores', [{ id: 50, id_condominio: 7, nome: 'Ana', bloco: 'B', apartamento: '308', id_user: 500, ativo: 1 }]);
  db.semear('tags', [
    { id: 1, id_condominio: 7, codigo: 'G2-000001', tipo: 'tag_ativo', id_device: 10, guarita_tipo: 2, guarita_serial: '000001', guarita_estado: 'ativo', guarita_frame: '20000001000003080100FF' + '20'.repeat(18) + '001600' + '20'.repeat(7) },
  ]);
  db.semear('veiculos', [{ id: 70, id_condominio: 7, id_morador: 50, placa: 'ABC1D23', id_tag: 1, ativo: 1 }]);
  return { db, ops: new GuaritaOperacoesService(db as any) };
}

describe('I7 — remover a unidade tira do Guarita os dispositivos de quem morava nela', () => {
  it('ApartamentosService.remove: tags lidas antes do delete, remoção na fila', async () => {
    const { db, ops } = montar();
    const tenant: any = { assertEntidade: jest.fn(async () => true), assertPermissaoFuncionario: jest.fn(async () => true) };
    const svc = new ApartamentosService(db as any, tenant, { registrar: jest.fn(async () => undefined) } as any, ops);
    const r: any = await svc.remove(1, { sub: 1, nome: 'Síndica', typeAccess: 'Sindico' } as any);
    expect(r.guarita_remocoes).toBe(1);
    expect(db.linhas('guarita_Operacoes').filter((o: any) => o.tipo === 'apagar')).toHaveLength(1);
    expect(db.linhas('tags')[0].guarita_estado).toBe('removendo');
  });
});

describe('Menor 12 — unidade sem bloco: null e vazio são o mesmo bloco', () => {
  it('apartamento com bloco null e morador com bloco vazio: a remoção sai', async () => {
    const { db, ops } = montar();
    db.linhas('apartamentos')[0].bloco = null;
    db.linhas('moradores')[0].bloco = '';
    const tenant: any = { assertEntidade: jest.fn(async () => true), assertPermissaoFuncionario: jest.fn(async () => true) };
    const svc = new ApartamentosService(db as any, tenant, { registrar: jest.fn(async () => undefined) } as any, ops);
    const r: any = await svc.remove(1, { sub: 1, nome: 'Síndica', typeAccess: 'Sindico' } as any);
    expect(r.guarita_remocoes).toBe(1);
  });
});

describe('I7 — troca/remoção de tag pelo app com o Guarita desativado', () => {
  it('a remoção da tag antiga entra na fila mesmo com o aparelho desativado', async () => {
    const { db, ops } = montar(0);
    const svc: any = Object.create(MobileAuthService.prototype);
    svc.prisma = db;
    svc.guarita = ops;
    svc.logger = new Logger('teste');
    await svc.atualizarVeiculoMorador(500, 7, { id: 70, placa: 'ABC1D23', tag_codigo: '' });
    expect(db.linhas('guarita_Operacoes').filter((o: any) => o.tipo === 'apagar' && o.estado === 'pendente')).toHaveLength(1);
    expect(db.linhas('veiculos')[0].id_tag).toBeNull();
  });
});

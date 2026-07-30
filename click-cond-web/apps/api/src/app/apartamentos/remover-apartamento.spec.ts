import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApartamentosService } from './apartamentos.service';
import { ApartamentosController } from './apartamentos.controller';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Apagar um apartamento é a operação mais destrutiva do sistema: TODAS as
 * chaves estrangeiras que apontam para Apartamentos são `onDelete: Cascade`,
 * então vínculos de morador, visitantes, vagas, reservas e mudanças somem
 * junto — sem confirmação e sem rastro.
 *
 * E o controller nem esperava o resultado: respondia `{ ok: true }` na hora.
 * 403, falha de banco ou apartamento inexistente viravam sucesso na tela.
 */
describe('ApartamentosService — remover unidade', () => {
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico', id_condominio: 1 };
  const morador: JwtPayload = { sub: 2, nome: 'Morador', typeAccess: 'Morador' };

  function build(opts: { existe?: boolean; falhaAoApagar?: any } = {}) {
    const auditado: any[] = [];
    const prisma: any = {
      isConnected: true,
      apartamentos: {
        findUnique: jest.fn(async () =>
          opts.existe === false ? null : { id_condominio: 1, apto: '101', bloco: 'A' },
        ),
        delete: jest.fn(async () => {
          if (opts.falhaAoApagar) throw opts.falhaAoApagar;
          return { id: 5 };
        }),
      },
      apartamentos_Users: { count: jest.fn(async () => 2) },
      visitantes: { count: jest.fn(async () => 7) },
      vagas: { count: jest.fn(async () => 1) },
      areas_Sociais_Agendamentos: { count: jest.fn(async () => 3) },
      mudancas: { count: jest.fn(async () => 0) },
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined), assertCondominio: jest.fn(async () => undefined) };
    const auditoria: any = { registrar: jest.fn(async (r: any) => auditado.push(r)) };
    const svc = new ApartamentosService(prisma, tenant, auditoria);
    return { svc, prisma, auditado, ctrl: new ApartamentosController(svc) };
  }

  it('conta e devolve o que a cascata levou junto', async () => {
    const { svc } = build();
    const r: any = await svc.remove(5, sindico);
    expect(r.success).toBe(true);
    expect(r.arrastados).toEqual({
      moradores: 2, visitantes: 7, vagas: 1, agendamentos: 3, mudancas: 0,
    });
  });

  it('registra a exclusão em cascata na auditoria', async () => {
    const { svc, auditado } = build();
    await svc.remove(5, sindico);
    expect(auditado).toHaveLength(1);
    expect(auditado[0].modulo).toBe('apartamentos');
    expect(auditado[0].acao).toBe('DELETE');
    expect(auditado[0].descricao).toContain('7 visita(s)');
    expect(auditado[0].detalhes.arrastados.moradores).toBe(2);
  });

  /**
   * O catch respondia sempre "não encontrado", mascarando a causa real —
   * mesmo padrão que escondia a violação de chave estrangeira em visitantes.
   */
  it('falha de banco não vira mais "não encontrado"', async () => {
    const { svc } = build({ falhaAoApagar: Object.assign(new Error('deadlock'), { code: 'P2034' }) });
    const erro = await svc.remove(5, sindico).catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro).not.toBeInstanceOf(NotFoundException);
    expect(erro.message).toContain('P2034');
  });

  it('apartamento inexistente continua 404', async () => {
    const { svc } = build({ existe: false });
    await expect(svc.remove(5, sindico)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('morador não remove apartamento', async () => {
    const { svc, prisma } = build();
    await expect(svc.remove(5, morador)).rejects.toThrow();
    expect(prisma.apartamentos.delete).not.toHaveBeenCalled();
  });

  describe('controller', () => {
    it('espera o service e propaga a falha em vez de responder ok', async () => {
      const { ctrl } = build({ falhaAoApagar: new Error('boom') });
      await expect(ctrl.remove(5, sindico)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('só responde depois de concluir, com o resumo da cascata', async () => {
      const { ctrl } = build();
      const r: any = await ctrl.remove(5, sindico);
      expect(r.success).toBe(true);
      expect(r.arrastados.visitantes).toBe(7);
    });
  });
});

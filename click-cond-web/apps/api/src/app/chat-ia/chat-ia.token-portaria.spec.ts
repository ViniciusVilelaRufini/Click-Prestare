import { ForbiddenException } from '@nestjs/common';
import { ChatIaService } from './chat-ia.service';

/**
 * O porteiro do console tem `sub = Funcionarios_Portaria.id` e nenhum Users.id. Lido como Users.id,
 * o `sub` dele confirmava a proposta de reserva do morador de mesmo número e gravava a reserva em
 * nome desse morador. O id do usuário sai de idUsuarioDoToken — sem ele, a ação é recusada.
 */
describe('ChatIaService — confirmar ação com token sem Users.id', () => {
  const PORTEIRO = { sub: 7, tipo_sub: 'funcionario_portaria', id_condominio: 1, nome: 'Porteiro' } as any;
  const MORADOR = { sub: 7, typeAccess: 'Morador', user: { id: 7 }, nome: 'Morador' } as any;

  function montar() {
    const acao = {
      id: 'a1',
      tipo: 'reserva_area',
      idUser: 7,
      idCondominio: 1,
      titulo: 'Reserva',
      itens: [],
      payload: { id_area_social: 1, id_apartamento: 10, data: '2099-01-10', hora_de: '12:00', hora_ate: '18:00' },
    };
    const acoes = {
      obterParaConfirmar: jest.fn(async (_id: string, idUser: number) =>
        idUser === 7 ? { acao } : { erro: 'Solicitação não encontrada.' },
      ),
      marcarConsumida: jest.fn().mockResolvedValue(true),
      liberar: jest.fn().mockResolvedValue(undefined),
    };
    const areasSociais = { insertAgendamento: jest.fn().mockResolvedValue({ id: 99 }) };
    const tenant = { assertCondominio: jest.fn().mockResolvedValue(undefined) };
    const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
    const svc = new ChatIaService(
      {} as any,
      tenant as any,
      {} as any,
      acoes as any,
      areasSociais as any,
      {} as any,
      auditoria as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { svc, acoes, areasSociais };
  }

  it('porteiro do console não confirma reserva em nome do Users de mesmo número', async () => {
    const { svc, acoes, areasSociais } = montar();

    await expect(svc.confirmarAcao(1, 'a1', PORTEIRO)).rejects.toBeInstanceOf(ForbiddenException);

    expect(areasSociais.insertAgendamento).not.toHaveBeenCalled();
    expect(acoes.marcarConsumida).not.toHaveBeenCalled();
  });

  it('morador dono da proposta segue reservando como Morador', async () => {
    const { svc, areasSociais } = montar();

    await expect(svc.confirmarAcao(1, 'a1', MORADOR)).resolves.toMatchObject({ ok: true });

    expect(areasSociais.insertAgendamento).toHaveBeenCalledWith(
      expect.objectContaining({ user: 7 }),
      7,
      'Morador',
      MORADOR,
    );
  });
});

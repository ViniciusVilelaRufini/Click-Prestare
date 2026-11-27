import { BadRequestException, ConflictException } from '@nestjs/common';
import { T0, montarPortao } from './portao/montar-portao.spec';

/** Correções do teste em produção: entregador bloqueado, retirada com quem retirou e papel do autor na linha do tempo. */
describe('delivery — correções do teste em produção', () => {
  const porteiro = { sub: 20, id_condominio: 1, nome: 'Portaria' } as any;
  const atendimento = (extra: Record<string, unknown> = {}) => ({
    id: 1,
    id_condominio: 1,
    id_apartamento: 101,
    id_morador_user: 7,
    origem: 'portaria',
    status: 'CHEGOU',
    modo_entrega: 'UNIDADE',
    id_pedido_portao: null,
    id_entregador: null,
    previsao_em: null,
    chegou_em: new Date(T0),
    created_at: new Date(T0),
    updated_at: new Date(T0),
    ...extra,
  });
  const entregador = (id: number, status: string) => ({ id, id_condominio: 1, nome: 'Zé', status });

  describe('entregador bloqueado', () => {
    it('portaria não pede autorização com o entregador do dto bloqueado', async () => {
      const k = montarPortao({ atendimentos: [atendimento()] });
      k.tabela('deliveryEntregadores').push(entregador(5, 'BLOQUEADO'));
      await expect(
        k.delivery.atualizarStatus(1, { status: 'AGUARDANDO_AUTORIZACAO', id_entregador: 5 } as any, porteiro),
      ).rejects.toThrow(new ConflictException('Entregador bloqueado: recuse a entrega ou identifique outro entregador.'));
      expect(k.tabela('deliveryAtendimentos')[0].status).toBe('CHEGOU');
    });

    it('nem com o entregador já gravado bloqueado', async () => {
      const k = montarPortao({ atendimentos: [atendimento({ id_entregador: 5 })] });
      k.tabela('deliveryEntregadores').push(entregador(5, 'BLOQUEADO'));
      await expect(
        k.delivery.atualizarStatus(1, { status: 'AGUARDANDO_AUTORIZACAO' } as any, porteiro),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('entregador ativo segue normal', async () => {
      const k = montarPortao({ atendimentos: [atendimento()] });
      k.tabela('deliveryEntregadores').push(entregador(6, 'ATIVO'));
      const r = await k.delivery.atualizarStatus(1, { status: 'AGUARDANDO_AUTORIZACAO', id_entregador: 6 } as any, porteiro);
      expect(r.status).toBe('AGUARDANDO_AUTORIZACAO');
    });
  });

  describe('retirada na portaria', () => {
    const montar = () => montarPortao({ atendimentos: [atendimento({ status: 'RETIRADA_NA_PORTARIA' })] });

    it('portaria precisa informar quem retirou e a relação', async () => {
      const msg = new BadRequestException('Informe quem retirou e a relação com o morador.');
      for (const dto of [
        {},
        { retirado_por: '   ', relacao_retirada: 'Familiar' },
        { retirado_por: 'Maria' },
        { retirado_por: 'Maria', relacao_retirada: 'Vizinho' },
      ]) {
        const k = montar();
        await expect(k.delivery.atualizarStatus(1, { status: 'CONCLUIDA', ...dto } as any, porteiro)).rejects.toThrow(msg);
        expect(k.tabela('deliveryAtendimentos')[0].status).toBe('RETIRADA_NA_PORTARIA');
      }
    });

    it('grava na mensagem do evento CONCLUIDA', async () => {
      const k = montar();
      const r = await k.delivery.atualizarStatus(
        1,
        { status: 'CONCLUIDA', retirado_por: ' Maria Souza ', relacao_retirada: 'Familiar' } as any,
        porteiro,
      );
      expect(r.status).toBe('CONCLUIDA');
      expect(k.tabela('deliveryEventos').find((e: any) => e.status_novo === 'CONCLUIDA').mensagem).toBe(
        'Retirado por Maria Souza (Familiar)',
      );
    });

    it('usa o rótulo da relação', async () => {
      const k = montar();
      await k.delivery.atualizarStatus(
        1,
        { status: 'CONCLUIDA', retirado_por: 'Ana', relacao_retirada: 'Funcionario' } as any,
        porteiro,
      );
      expect(k.tabela('deliveryEventos')[0].mensagem).toBe('Retirado por Ana (Funcionário do morador)');
    });

    it('AUTORIZADA para CONCLUIDA não exige', async () => {
      const k = montarPortao({ atendimentos: [atendimento({ status: 'AUTORIZADA' })] });
      const r = await k.delivery.atualizarStatus(1, { status: 'CONCLUIDA' } as any, porteiro);
      expect(r.status).toBe('CONCLUIDA');
    });

    it('AUTORIZADA em modo PORTARIA exige quem retirou, como a retirada na portaria', async () => {
      const k = montarPortao({ atendimentos: [atendimento({ status: 'AUTORIZADA', modo_entrega: 'PORTARIA' })] });
      await expect(k.delivery.atualizarStatus(1, { status: 'CONCLUIDA' } as any, porteiro)).rejects.toThrow(
        new BadRequestException('Informe quem retirou e a relação com o morador.'),
      );
      expect(k.tabela('deliveryAtendimentos')[0].status).toBe('AUTORIZADA');
      await k.delivery.atualizarStatus(
        1,
        { status: 'CONCLUIDA', retirado_por: 'Ana', relacao_retirada: 'Familiar' } as any,
        porteiro,
      );
      expect(k.tabela('deliveryEventos').find((e: any) => e.status_novo === 'CONCLUIDA').mensagem).toBe(
        'Retirado por Ana (Familiar)',
      );
    });

    it('falha nas consultas depois de gravar não vira 500: devolve sem eventos', async () => {
      const k = montar();
      (k.banco.prisma as any).deliveryEventos.findMany = async () => {
        throw new Error('timeout');
      };
      const r: any = await k.delivery.atualizarStatus(
        1,
        { status: 'CONCLUIDA', retirado_por: 'Maria', relacao_retirada: 'Outro' } as any,
        porteiro,
      );
      expect(r.status).toBe('CONCLUIDA');
      expect(r.eventos).toBeUndefined();
    });

    it('eventos devolvidos ordenam por created_at e id', async () => {
      const k = montar();
      const spy = jest.spyOn((k.banco.prisma as any).deliveryEventos, 'findMany');
      await k.delivery.atualizarStatus(
        1,
        { status: 'CONCLUIDA', retirado_por: 'Maria', relacao_retirada: 'Outro' } as any,
        porteiro,
      );
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ created_at: 'asc' }, { id: 'asc' }] }));
    });

    it('a resposta do PATCH da portaria traz os eventos ordenados com autor_papel', async () => {
      const k = montar();
      const r: any = await k.delivery.atualizarStatus(
        1,
        { status: 'CONCLUIDA', retirado_por: 'Maria', relacao_retirada: 'Outro' } as any,
        porteiro,
      );
      expect(r.eventos).toEqual([
        expect.objectContaining({ status_novo: 'CONCLUIDA', mensagem: 'Retirado por Maria (Outro)', autor_papel: 'portaria' }),
      ]);
    });

    it('encerramento automático não exige', async () => {
      const k = montar();
      expect(await k.delivery.transicionarPeloSistema(1, 'CONCLUIDA', 'Encerrado automaticamente')).toBeTruthy();
    });
  });

  describe('autor_papel na listagem', () => {
    const ev = (id: number, ant: string | null, novo: string, autor: string | null, idAutor: number | null) => ({
      id,
      id_atendimento: 1,
      status_anterior: ant,
      status_novo: novo,
      id_usuario_autor: idAutor,
      autor_nome: autor,
      mensagem: null,
      created_at: new Date(T0 + id),
    });
    const papeis = async (eventos: any[]) => {
      const k = montarPortao({ atendimentos: [atendimento({ status: 'AUTORIZADA' })] });
      k.tabela('deliveryEventos').push(...eventos);
      const lista: any[] = await k.delivery.listarAtendimentos(1, undefined, porteiro);
      return lista[0].eventos.map((e: any) => e.autor_papel);
    };

    it('sistema e autoatendimento', async () => {
      expect(
        await papeis([
          ev(1, 'CHEGOU', 'CANCELADA', 'Sistema', null),
          ev(2, null, 'CHEGOU', null, null),
          ev(3, null, 'CHEGOU', 'Autoatendimento', null),
        ]),
      ).toEqual(['sistema', 'sistema', 'autoatendimento']);
    });

    it('morador: aviso, resposta de quem tem vínculo e cancelamento do dono', async () => {
      expect(
        await papeis([
          ev(1, null, 'AGENDADA', 'Ana Lima', 7),
          ev(2, 'AGUARDANDO_AUTORIZACAO', 'AUTORIZADA', 'Bruno Reis', 9),
          ev(3, 'AGUARDANDO_AUTORIZACAO', 'RECUSADA', 'Ana Lima', 7),
          ev(4, 'AGENDADA', 'CANCELADA', 'Ana Lima', 7),
        ]),
      ).toEqual(['morador', 'morador', 'morador', 'morador']);
    });

    it('portaria: mesma transição sem vínculo, e demais', async () => {
      expect(
        await papeis([
          ev(1, 'AGUARDANDO_AUTORIZACAO', 'AUTORIZADA', 'Portaria', 20),
          ev(2, 'CHEGOU', 'AGUARDANDO_AUTORIZACAO', 'Ana Lima', 7),
          ev(3, 'AUTORIZADA', 'CONCLUIDA', 'Portaria', 20),
          ev(4, 'AGENDADA', 'CANCELADA', 'Portaria', 20),
        ]),
      ).toEqual(['portaria', 'portaria', 'portaria', 'portaria']);
    });
  });
});

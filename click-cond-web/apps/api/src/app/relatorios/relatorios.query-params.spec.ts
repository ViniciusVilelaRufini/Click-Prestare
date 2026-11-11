import { BadRequestException } from '@nestjs/common';
import { RelatoriosController } from './relatorios.controller';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Query string é texto do cliente: `page=abc` virava NaN no `skip` do Prisma,
 * `dataInicio=xyz` virava Invalid Date e `modulo=a&modulo=b` chegava como
 * array — os três estouravam em 500. Além disso, o porteiro lia pelo log os
 * módulos que só o síndico pode ver.
 */
describe('RelatoriosController — parâmetros de auditoria/eventos', () => {
  function build() {
    const service: any = {
      getAuditoria: jest.fn(async () => ({ items: [] })),
      exportAuditoriaCsv: jest.fn(async () => ({ buffer: Buffer.from(''), filename: 'x.csv' })),
      getEventos: jest.fn(async () => ({ items: [] })),
    };
    const res: any = { setHeader: jest.fn(), end: jest.fn() };
    return { ctrl: new RelatoriosController(service) as any, service, res };
  }

  const sindico: JwtPayload = { sub: 11, nome: 'Síndico', email: 's@x.com', typeAccess: 'Sindico' };
  const sindicoConsole: JwtPayload = { sub: 13, nome: 'Síndico Web', id_condominio: 1, turno: 'Síndico' };
  const porteiro: JwtPayload = { sub: 12, nome: 'Porteiro', id_condominio: 1, turno: 'Diurno' };

  describe('paginação', () => {
    it.each([
      ['abc', 'xyz'],
      ['', ''],
      ['-3', '-1'],
      ['1.5', '2.5'],
      [['2', '3'], { a: '1' }],
      ['NaN', 'Infinity'],
    ])('auditoria: page=%p pageSize=%p caem no padrão 1/50', async (page, pageSize) => {
      const { ctrl, service } = build();
      await ctrl.getAuditoria(1, porteiro, undefined, undefined, undefined, page, pageSize);
      const args = service.getAuditoria.mock.calls[0];
      expect(args[4]).toBe(1);
      expect(args[5]).toBe(50);
    });

    it('auditoria: valores válidos passam como número', async () => {
      const { ctrl, service } = build();
      await ctrl.getAuditoria(1, porteiro, undefined, undefined, undefined, '3', '20');
      const args = service.getAuditoria.mock.calls[0];
      expect(args[4]).toBe(3);
      expect(args[5]).toBe(20);
    });

    it('eventos: page/pageSize inválidos caem no padrão', async () => {
      const { ctrl, service } = build();
      await ctrl.getEventos(1, porteiro, undefined, undefined, 'abc', ['x']);
      expect(service.getEventos).toHaveBeenCalledWith(1, undefined, undefined, 1, 50, undefined);
    });
  });

  describe('datas', () => {
    it.each(['xyz', '2026-13-45', '01/09/2026', '2026-9-1', '2026-09-01T00:00:00'])(
      'auditoria: dataInicio=%p responde 400 com mensagem clara',
      async (data) => {
        const { ctrl, service } = build();
        const p = ctrl.getAuditoria(1, porteiro, undefined, data);
        await expect(p).rejects.toBeInstanceOf(BadRequestException);
        await expect(p).rejects.toThrow('dataInicio inválida: use o formato AAAA-MM-DD.');
        expect(service.getAuditoria).not.toHaveBeenCalled();
      },
    );

    it('auditoria: dataFim inválida responde 400', async () => {
      const { ctrl } = build();
      await expect(ctrl.getAuditoria(1, porteiro, undefined, '2026-09-01', 'ontem')).rejects.toThrow(
        'dataFim inválida: use o formato AAAA-MM-DD.',
      );
    });

    it('export: data inválida responde 400 e não exporta', async () => {
      const { ctrl, service, res } = build();
      await expect(ctrl.exportAuditoria(1, res, sindico, undefined, 'xyz')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(service.exportAuditoriaCsv).not.toHaveBeenCalled();
    });

    it('eventos: data inválida responde 400', async () => {
      const { ctrl, service } = build();
      await expect(ctrl.getEventos(1, porteiro, 'xyz')).rejects.toBeInstanceOf(BadRequestException);
      await expect(ctrl.getEventos(1, porteiro, undefined, 'xyz')).rejects.toBeInstanceOf(BadRequestException);
      expect(service.getEventos).not.toHaveBeenCalled();
    });

    it('data válida e data vazia passam (vazia vira undefined)', async () => {
      const { ctrl, service } = build();
      await ctrl.getEventos(1, porteiro, '2026-09-01', '');
      expect(service.getEventos).toHaveBeenCalledWith(1, '2026-09-01', undefined, 1, 50, undefined);
    });
  });

  describe('modulo e search não-string', () => {
    it('auditoria: modulo repetido usa o primeiro valor', async () => {
      const { ctrl, service } = build();
      await ctrl.getAuditoria(1, porteiro, ['visitantes', 'facial']);
      expect(service.getAuditoria.mock.calls[0][1]).toBe('visitantes');
    });

    it('auditoria: modulo objeto é ignorado', async () => {
      const { ctrl, service } = build();
      await ctrl.getAuditoria(1, porteiro, { a: 'b' });
      expect(service.getAuditoria.mock.calls[0][1]).toBeUndefined();
    });

    it('export: modulo repetido usa o primeiro valor', async () => {
      const { ctrl, service, res } = build();
      await ctrl.exportAuditoria(1, res, sindico, ['visitantes', 'facial']);
      expect(service.exportAuditoriaCsv.mock.calls[0][1]).toBe('visitantes');
    });

    it('eventos: search repetido usa o primeiro valor; objeto é ignorado', async () => {
      const { ctrl, service } = build();
      await ctrl.getEventos(1, porteiro, undefined, undefined, undefined, undefined, ['maria', 'joão']);
      expect(service.getEventos.mock.calls[0][5]).toBe('maria');
      await ctrl.getEventos(1, porteiro, undefined, undefined, undefined, undefined, { x: 'y' });
      expect(service.getEventos.mock.calls[1][5]).toBeUndefined();
    });
  });

  describe('módulos sigilosos na listagem', () => {
    it('porteiro: pede a listagem SEM os módulos sigilosos', async () => {
      const { ctrl, service } = build();
      await ctrl.getAuditoria(1, porteiro, 'financeiro');
      expect(service.getAuditoria).toHaveBeenCalledWith(1, 'financeiro', undefined, undefined, 1, 50, false);
    });

    it('síndico (app e console): pede a listagem completa', async () => {
      const { ctrl, service } = build();
      await ctrl.getAuditoria(1, sindico);
      await ctrl.getAuditoria(1, sindicoConsole);
      expect(service.getAuditoria.mock.calls[0][6]).toBe(true);
      expect(service.getAuditoria.mock.calls[1][6]).toBe(true);
    });
  });

  it('export: repassa quem exportou para o rastro de auditoria', async () => {
    const { ctrl, service, res } = build();
    await ctrl.exportAuditoria(1, res, sindico, 'visitantes', '2026-09-01', '2026-09-30');
    expect(service.exportAuditoriaCsv).toHaveBeenCalledWith(1, 'visitantes', '2026-09-01', '2026-09-30', {
      nome: 'Síndico',
      email: 's@x.com',
    });
  });
});

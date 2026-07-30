import { ForbiddenException } from '@nestjs/common';
import { RelatoriosController } from './relatorios.controller';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * O TenantGuard protege estas rotas contra acesso cross-condomínio (o
 * :idCondominio da URL tem que bater com o vínculo do solicitante), mas
 * morador TAMBÉM tem vínculo. Sem checagem de papel, qualquer morador
 * autenticado baixava o relatório financeiro completo do prédio — todos os
 * lançamentos, valores e status — além da auditoria e do feed de eventos.
 * No app essas telas só existem para o síndico; a API é que estava aberta.
 */
describe('RelatoriosController — só operador/síndico', () => {
  function build() {
    const service: any = {
      generate: jest.fn(async () => ({ buffer: Buffer.from(''), mime: 'text/csv', filename: 'x.csv' })),
      getAuditoria: jest.fn(async () => ({ itens: [] })),
      exportAuditoriaCsv: jest.fn(async () => ({ buffer: Buffer.from(''), filename: 'x.csv' })),
      getEventos: jest.fn(async () => ({ itens: [] })),
    };
    const res: any = { setHeader: jest.fn(), end: jest.fn() };
    return { ctrl: new RelatoriosController(service), service, res };
  }

  const morador: JwtPayload = { sub: 10, nome: 'Morador', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 11, nome: 'Síndico', typeAccess: 'Sindico' };
  const porteiroWeb: JwtPayload = { sub: 12, nome: 'Porteiro', id_condominio: 1 };

  it('NEGA morador baixar o relatório financeiro do condomínio', async () => {
    const { ctrl, service, res } = build();
    await expect(
      ctrl.download(1, res, morador, 'financeiro', 'xlsx'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.generate).not.toHaveBeenCalled();
  });

  it('NEGA morador ler a auditoria', async () => {
    const { ctrl, service } = build();
    await expect(ctrl.getAuditoria(1, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.getAuditoria).not.toHaveBeenCalled();
  });

  it('NEGA morador exportar a auditoria', async () => {
    const { ctrl, service, res } = build();
    await expect(ctrl.exportAuditoria(1, res, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.exportAuditoriaCsv).not.toHaveBeenCalled();
  });

  it('NEGA morador ler o feed de eventos', async () => {
    const { ctrl, service } = build();
    await expect(ctrl.getEventos(1, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.getEventos).not.toHaveBeenCalled();
  });

  it('PERMITE síndico do app', async () => {
    const { ctrl, service, res } = build();
    await ctrl.download(1, res, sindico, 'financeiro', 'xlsx');
    expect(service.generate).toHaveBeenCalled();
  });

  it('PERMITE operador da portaria-web (token sem typeAccess)', async () => {
    const { ctrl, service } = build();
    await ctrl.getEventos(1, porteiroWeb);
    expect(service.getEventos).toHaveBeenCalled();
  });
});

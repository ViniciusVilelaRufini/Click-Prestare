import { ForbiddenException } from '@nestjs/common';
import { VisitasController } from './visitas.controller';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Item 3 do fase0: mesmo risco do PessoasController — TenantGuard sozinho
 * não distingue morador de operador. `VisitasController` só expõe leitura
 * (ver visitas.controller.ts) — as rotas de escrita (criar, entrada, saída)
 * foram removidas numa auditoria por exporem `VisitasService` sem as
 * checagens que o caminho de verdade sempre aplica antes de chamá-lo.
 */
describe('VisitasController — exige operador (leitura)', () => {
  const morador: JwtPayload = { sub: 10, nome: 'Morador', typeAccess: 'Morador' };
  const porteiroWeb: JwtPayload = { sub: 12, nome: 'Porteiro', id_condominio: 1 };

  function build() {
    const service: any = {
      listarPresenca: jest.fn(async () => []),
      listarVisitasCondominio: jest.fn(async () => []),
    };
    return { ctrl: new VisitasController(service), service };
  }

  it('NEGA morador ver quem está presente no condomínio', async () => {
    const { ctrl, service } = build();
    await expect(ctrl.listarPresenca(1, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.listarPresenca).not.toHaveBeenCalled();
  });

  it('NEGA morador listar as visitas do condomínio', async () => {
    const { ctrl, service } = build();
    await expect(ctrl.listar(1, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.listarVisitasCondominio).not.toHaveBeenCalled();
  });

  it('PERMITE operador da portaria-web listar presença', async () => {
    const { ctrl, service } = build();
    await ctrl.listarPresenca(1, porteiroWeb);
    expect(service.listarPresenca).toHaveBeenCalled();
  });

  it('PERMITE operador da portaria-web listar visitas do condomínio', async () => {
    const { ctrl, service } = build();
    await ctrl.listar(1, porteiroWeb);
    expect(service.listarVisitasCondominio).toHaveBeenCalled();
  });
});

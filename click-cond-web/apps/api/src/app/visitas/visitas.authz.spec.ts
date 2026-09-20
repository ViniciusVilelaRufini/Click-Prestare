import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { VisitasController } from './visitas.controller';
import { VisitasService } from './visitas.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Item 3 do fase0: mesmo risco do PessoasController — TenantGuard sozinho
 * não distingue morador de operador, e `:idVisita` no path nunca foi
 * comparado com o `:idCondominio` da rota (IDOR cross-tenant nas escritas de
 * entrada/saída, que MEXEM em estado físico de outro condomínio).
 */
describe('VisitasController — exige operador e fecha IDOR cross-tenant', () => {
  const morador: JwtPayload = { sub: 10, nome: 'Morador', typeAccess: 'Morador' };
  const sindicoApp: JwtPayload = { sub: 11, nome: 'Síndico', typeAccess: 'Sindico' };
  const porteiroWeb: JwtPayload = { sub: 12, nome: 'Porteiro', id_condominio: 1 };

  function build() {
    const service: any = {
      listarPresenca: jest.fn(async () => []),
      listarVisitasCondominio: jest.fn(async () => []),
      criarVisita: jest.fn(async () => ({ id: 1 })),
      registrarEntrada: jest.fn(async () => ({ id: 1 })),
      registrarSaida: jest.fn(async () => ({ id: 1 })),
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

  it('NEGA morador criar uma visita', async () => {
    const { ctrl, service } = build();
    await expect(ctrl.criar(1, {} as any, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.criarVisita).not.toHaveBeenCalled();
  });

  it('NEGA morador registrar entrada de uma visita', async () => {
    const { ctrl, service } = build();
    await expect(ctrl.registrarEntrada(1, 5, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.registrarEntrada).not.toHaveBeenCalled();
  });

  it('NEGA morador registrar saída de uma visita', async () => {
    const { ctrl, service } = build();
    await expect(ctrl.registrarSaida(1, 5, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.registrarSaida).not.toHaveBeenCalled();
  });

  it('PERMITE operador da portaria-web listar presença', async () => {
    const { ctrl, service } = build();
    await ctrl.listarPresenca(1, porteiroWeb);
    expect(service.listarPresenca).toHaveBeenCalled();
  });

  it('PERMITE síndico do app registrar entrada', async () => {
    const { ctrl, service } = build();
    await ctrl.registrarEntrada(1, 5, sindicoApp);
    expect(service.registrarEntrada).toHaveBeenCalledWith(5, 1);
  });

  describe('IDOR cross-tenant em entrada/saída (via service real)', () => {
    function buildReal(visita: any) {
      const mockPrisma: any = {
        visitas: {
          findUnique: jest.fn().mockResolvedValue(visita),
          update: jest.fn().mockResolvedValue({ id: visita?.id }),
        },
        vagas: { updateMany: jest.fn() },
      };
      const mockPessoasService: any = {};
      const service = new VisitasService(mockPrisma, mockPessoasService);
      const ctrl = new VisitasController(service);
      return { ctrl, mockPrisma };
    }

    it('operador do condomínio A é recusado ao registrar ENTRADA em visita do condomínio B', async () => {
      const { ctrl, mockPrisma } = buildReal({ id: 100, id_condominio: 2 });

      await expect(ctrl.registrarEntrada(1, 100, porteiroWeb)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockPrisma.visitas.update).not.toHaveBeenCalled();
    });

    it('operador do condomínio A é recusado ao registrar SAÍDA em visita do condomínio B', async () => {
      const { ctrl, mockPrisma } = buildReal({ id: 100, id_condominio: 2 });

      await expect(ctrl.registrarSaida(1, 100, porteiroWeb)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockPrisma.visitas.update).not.toHaveBeenCalled();
    });

    it('operador do condomínio correto registra entrada normalmente', async () => {
      const { ctrl, mockPrisma } = buildReal({ id: 100, id_condominio: 1 });

      await ctrl.registrarEntrada(1, 100, porteiroWeb);
      expect(mockPrisma.visitas.update).toHaveBeenCalled();
    });

    it('visita inexistente devolve 404, não 500', async () => {
      const { ctrl } = buildReal(null);

      await expect(ctrl.registrarEntrada(1, 999, porteiroWeb)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

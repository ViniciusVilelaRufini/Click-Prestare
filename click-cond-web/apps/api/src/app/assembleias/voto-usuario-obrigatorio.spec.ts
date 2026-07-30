import { ForbiddenException } from '@nestjs/common';
import { AssembleiasController } from './assembleias.controller';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Cinco rotas resolviam o id do usuário com `?? 1` como fallback: sem id no
 * payload, a ação era atribuída ao usuário 1.
 *
 * Numa delas isso é registro de VOTO — o voto entraria no sistema como sendo
 * de outra pessoa. Não dispara hoje (o JwtAuthGuard é global), mas é um
 * default que falha ABERTO: age em nome de alguém em vez de recusar.
 */
describe('AssembleiasController — id do usuário é obrigatório', () => {
  function build() {
    const service: any = {
      insert: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      get: jest.fn(async () => ({})),
      registerVoto: jest.fn(async () => ({ success: true })),
      enqueteGet: jest.fn(async () => ({})),
    };
    return { ctrl: new AssembleiasController(service), service };
  }

  const semUsuario = {} as JwtPayload;
  const morador: JwtPayload = { sub: 42, nome: 'Morador', typeAccess: 'Morador' };

  it('NEGA registrar voto sem usuário na sessão (era voto do usuário 1)', () => {
    const { ctrl, service } = build();
    expect(() =>
      ctrl.registerVoto({ voto: { votacao_id: 5, opcao_id: 9 } }, semUsuario),
    ).toThrow(ForbiddenException);
    expect(service.registerVoto).not.toHaveBeenCalled();
  });

  it('registra o voto com o id que veio do JWT', () => {
    const { ctrl, service } = build();
    ctrl.registerVoto({ voto: { votacao_id: 5, opcao_id: 9 } }, morador);
    expect(service.registerVoto).toHaveBeenCalledWith(5, 9, 42, morador);
  });

  it('payload inválido continua sendo 400, não 403', () => {
    const { ctrl } = build();
    // A validação do corpo vem antes: sem voto no body, é erro de requisição.
    expect(() => ctrl.registerVoto({} as any, morador)).toThrow(/Payload inválido/);
  });
});

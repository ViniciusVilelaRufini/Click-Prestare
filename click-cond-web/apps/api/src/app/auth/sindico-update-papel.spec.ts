import { ForbiddenException } from '@nestjs/common';
import { SindicoMobileController } from './mobile-auth.controller';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * POST /sindico/update devolve um token typeAccess 'Sindico' de 365 dias. O
 * controller só olhava o id do token: quem entrava por /moradores/login ou
 * /funcionarios/login (sem o 2º fator do login de síndico) numa conta que
 * também tem perfil em Sindicos saía daqui com sessão de síndico.
 */
describe('POST /sindico/update exige sessão de síndico', () => {
  const corpo = { nome: 'Fulano', phone: '17999990000' };
  const servico = () => ({ updateSindico: jest.fn().mockResolvedValue({ token: 't', user: { id: 7 } }) });

  it.each([['Morador'], ['Funcionario']])(
    'token %s da mesma conta NÃO vira token de síndico',
    (papel) => {
      const service = servico();
      const controller = new SindicoMobileController(service as any);
      const payload: JwtPayload = { sub: 7, nome: 'Fulano', typeAccess: papel, user: { id: 7 } };

      expect(() => controller.updateSindico(payload, corpo)).toThrow(ForbiddenException);
      expect(service.updateSindico).not.toHaveBeenCalled();
    },
  );

  it('token de síndico continua atualizando o cadastro', async () => {
    const service = servico();
    const controller = new SindicoMobileController(service as any);
    const payload: JwtPayload = { sub: 7, nome: 'Fulano', typeAccess: 'Sindico', user: { id: 7 } };

    await controller.updateSindico(payload, corpo);
    expect(service.updateSindico).toHaveBeenCalledWith(7, corpo);
  });
});

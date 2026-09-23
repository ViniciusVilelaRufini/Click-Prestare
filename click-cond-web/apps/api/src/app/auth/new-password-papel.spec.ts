import {
  FuncionariosMobileController,
  MoradoresMobileController,
  SindicoMobileController,
} from './mobile-auth.controller';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * A troca de senha devolve um token novo. O papel desse token vinha do NOME
 * da rota: um morador que chamasse /sindico/new-password com a própria senha
 * saía com um token typeAccess 'Sindico'. O papel tem que ser o do token de
 * quem chamou.
 */
const morador: JwtPayload = { sub: 8, nome: 'QA_SECURITY_20260923', typeAccess: 'Morador', user: { id: 8 } };
const body = { senha: 'QA_SECURITY_20260923_nova', senha_atual: 'QA_SECURITY_20260923_atual' };

describe('new-password mantém o papel do token de quem chama', () => {
  it.each([
    ['/sindico/new-password', SindicoMobileController],
    ['/moradores/new-password', MoradoresMobileController],
    ['/funcionarios/new-password', FuncionariosMobileController],
  ])('%s com token de morador emite token de morador', (_rota, Classe: any) => {
    const service = { updatePassword: jest.fn().mockResolvedValue({}) };
    const controller = new Classe(service, {} as any, {} as any);
    controller.newPassword(morador, body);
    expect(service.updatePassword).toHaveBeenCalledWith(8, body.senha, 'Morador', body.senha_atual);
  });
});

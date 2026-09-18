import { Test, TestingModule } from '@nestjs/testing';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';

describe('MfaController', () => {
  let controller: MfaController;
  let service: any;

  beforeEach(async () => {
    service = {
      verifyChallenge: jest.fn().mockResolvedValue({
        token: 'jwt-123',
        user: { id: 42, name: 'Síndico Teste' },
      }),
      resendChallenge: jest.fn().mockResolvedValue({
        success: true,
        message: 'Novo código enviado com sucesso!',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MfaController],
      providers: [{ provide: MfaService, useValue: service }],
    }).compile();

    controller = module.get<MfaController>(MfaController);
  });

  it('deve chamar verifyChallenge passando mfa_token, code, remember_device e meta', async () => {
    const mockReq = {
      headers: { 'user-agent': 'Flutter-Test' },
      ip: '127.0.0.1',
    };

    const res = await controller.verify(
      { mfa_token: 'tok-123', code: '654321', remember_device: true },
      mockReq,
    );

    expect(res.token).toBe('jwt-123');
    expect(service.verifyChallenge).toHaveBeenCalledWith(
      'tok-123',
      '654321',
      true,
      expect.objectContaining({ userAgent: 'Flutter-Test' }),
    );
  });

  it('deve chamar resendChallenge com mfa_token', async () => {
    const res = await controller.resend({ mfa_token: 'tok-123' });
    expect(res.success).toBe(true);
    expect(service.resendChallenge).toHaveBeenCalledWith('tok-123');
  });
});

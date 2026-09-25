import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';

describe('Recuperação de Senha Segura via Deep Link (F2)', () => {
  let service: MobileAuthService;
  let prisma: any;
  let mail: any;

  beforeEach(() => {
    prisma = {
      isConnected: true,
      users: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      sindicos_Condominios: {
        findFirst: jest.fn(),
      },
      moradores: {
        findFirst: jest.fn(),
      },
      apartamentos_Users: {
        findFirst: jest.fn(),
      },
      funcionarios_Portaria: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      redefinicoes_Senha: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };

    mail = {
      sendResetPasswordLink: jest.fn().mockResolvedValue(undefined),
      sendResetPasswordCode: jest.fn().mockResolvedValue(true),
      sendForgotPassword: jest.fn().mockResolvedValue(undefined),
    };

    service = new MobileAuthService(
      prisma,
      { sign: jest.fn().mockReturnValue('mock-jwt-token') } as any,
      mail,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  describe('solicitarRedefinicaoSenha', () => {
    it('retorna mensagem genérica de sucesso quando e-mail não existe (anti-enumeração)', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      const res = await service.solicitarRedefinicaoSenha('inexistente@exemplo.com', 'sindico');

      expect(res.success).toBe(true);
      expect(res.message).toContain('Se o e-mail estiver cadastrado');
      expect(prisma.users.update).not.toHaveBeenCalled();
      expect(mail.sendResetPasswordLink).not.toHaveBeenCalled();
      expect(prisma.redefinicoes_Senha.create).not.toHaveBeenCalled();
    });

    it('NÃO altera a senha no momento da solicitação para Síndico', async () => {
      prisma.users.findFirst.mockResolvedValue({
        id: 10,
        login: 'sindico@exemplo.com',
        sindicos: [{ id: 1, name: 'Síndico Teste', id_condominio: 2 }],
      });
      prisma.redefinicoes_Senha.updateMany.mockResolvedValue({ count: 0 });
      prisma.redefinicoes_Senha.create.mockResolvedValue({ id: 1 });

      const res = await service.solicitarRedefinicaoSenha('sindico@exemplo.com', 'sindico', '192.168.1.1');

      expect(res.success).toBe(true);
      expect(prisma.users.update).not.toHaveBeenCalled(); // Senha NÃO deve ser alterada aqui!
      expect(prisma.redefinicoes_Senha.updateMany).toHaveBeenCalledWith({
        where: { id_conta: 10, papel: 'sindico', usado_em: null },
        data: { usado_em: expect.any(Date) },
      });
      expect(prisma.redefinicoes_Senha.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id_conta: 10,
          papel: 'sindico',
          token_hash: expect.any(String),
          expira_em: expect.any(Date),
          ip: '192.168.1.1',
        }),
      });

      // Aguarda despacho do setImmediate (timing attack neutralization)
      await new Promise((r) => setImmediate(r));
      expect(mail.sendResetPasswordLink).toHaveBeenCalledWith(
        'sindico@exemplo.com',
        expect.any(String),
        'Síndico',
      );
    });

    it('solicita redefinição com sucesso para Morador', async () => {
      prisma.moradores.findFirst.mockResolvedValue({ id: 5, email: 'morador@exemplo.com' });
      prisma.users.findFirst.mockResolvedValue({ id: 20, login: 'morador@exemplo.com' });
      prisma.redefinicoes_Senha.updateMany.mockResolvedValue({ count: 0 });
      prisma.redefinicoes_Senha.create.mockResolvedValue({ id: 2 });

      const res = await service.solicitarRedefinicaoSenha('morador@exemplo.com', 'morador');

      expect(res.success).toBe(true);
      expect(prisma.users.update).not.toHaveBeenCalled();

      await new Promise((r) => setImmediate(r));
      expect(mail.sendResetPasswordLink).toHaveBeenCalledWith(
        'morador@exemplo.com',
        expect.any(String),
        'Morador',
      );
    });

    it('solicita redefinição com sucesso para Funcionário', async () => {
      prisma.funcionarios_Portaria.findFirst.mockResolvedValue({
        id: 30,
        login: 'porteiro@exemplo.com',
        id_condominio: 2,
      });
      prisma.redefinicoes_Senha.updateMany.mockResolvedValue({ count: 0 });
      prisma.redefinicoes_Senha.create.mockResolvedValue({ id: 3 });

      const res = await service.solicitarRedefinicaoSenha('porteiro@exemplo.com', 'funcionario');

      expect(res.success).toBe(true);
      expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();

      await new Promise((r) => setImmediate(r));
      expect(mail.sendResetPasswordLink).toHaveBeenCalledWith(
        'porteiro@exemplo.com',
        expect.any(String),
        'Funcionário',
      );
    });

    it('limita a 3 solicitações por hora por conta e papel para prevenir spam na caixa de entrada', async () => {
      prisma.users.findFirst.mockResolvedValue({
        id: 10,
        login: 'sindico@exemplo.com',
        sindicos: [{ id: 1, name: 'Síndico Teste', id_condominio: 2 }],
      });
      prisma.redefinicoes_Senha.count.mockResolvedValue(3); // Já atingiu 3 na última hora

      const res = await service.solicitarRedefinicaoSenha('sindico@exemplo.com', 'sindico');

      expect(res.success).toBe(true);
      expect(prisma.redefinicoes_Senha.count).toHaveBeenCalledWith({
        where: {
          id_conta: 10,
          papel: 'sindico',
          criado_em: { gte: expect.any(Date) },
        },
      });
      expect(prisma.redefinicoes_Senha.create).not.toHaveBeenCalled();

      await new Promise((r) => setImmediate(r));
      expect(mail.sendResetPasswordLink).not.toHaveBeenCalled();
    });
  });

  describe('confirmarRedefinicaoSenha', () => {
    it('rejeita requisições sem token ou sem nova senha', async () => {
      await expect(service.confirmarRedefinicaoSenha('', 'nova123')).rejects.toThrow(BadRequestException);
      await expect(service.confirmarRedefinicaoSenha('tokenValido', '')).rejects.toThrow(BadRequestException);
    });

    it('rejeita senha com menos de 6 caracteres', async () => {
      await expect(service.confirmarRedefinicaoSenha('tokenValido', '12345')).rejects.toThrow(
        /mínimo 6 caracteres/i,
      );
    });

    it('rejeita token inválido ou não encontrado', async () => {
      prisma.redefinicoes_Senha.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirmarRedefinicaoSenha('tokenInvalido', 'novaSenha123')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejeita token já utilizado ou expirado', async () => {
      prisma.redefinicoes_Senha.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirmarRedefinicaoSenha('tokenExpirado', 'novaSenha123')).rejects.toThrow(
        /inválido ou expirado/i,
      );
    });

    it('impede uso concorrente do mesmo token via updateMany atômico (race condition)', async () => {
      const rawToken = 'token-duplo-clique';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      // Simula que outra requisição já usou o token uma fração de segundo antes
      prisma.redefinicoes_Senha.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirmarRedefinicaoSenha(rawToken, 'NovaSenha@123')).rejects.toThrow(
        /inválido ou expirado/i,
      );
      expect(prisma.redefinicoes_Senha.updateMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { token_hash: tokenHash },
            { reset_token_hash: tokenHash },
          ],
          usado_em: null,
          expira_em: { gt: expect.any(Date) },
        },
        data: {
          usado_em: expect.any(Date),
        },
      });
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('redefine senha de Morador com hash bcrypt e grava auditoria com dados do morador', async () => {
      const rawToken = 'segredo-32-bytes-aleatorio';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      prisma.redefinicoes_Senha.updateMany.mockResolvedValue({ count: 1 });
      prisma.redefinicoes_Senha.findFirst.mockResolvedValue({
        id: 101,
        papel: 'morador',
        id_conta: 55,
        token_hash: tokenHash,
        expira_em: new Date(Date.now() + 15 * 60 * 1000),
        usado_em: new Date(),
        ip: '189.10.20.30',
      });
      prisma.moradores.findFirst.mockResolvedValue({
        id_condominio: 15,
        nome: 'Morador João',
        email: 'joao@morador.com',
      });

      prisma.users.update.mockResolvedValue({ id: 55 });

      const res = await service.confirmarRedefinicaoSenha(rawToken, 'MinhaNovaSenha@2026');

      expect(res.success).toBe(true);
      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: 55 },
        data: {
          password: expect.stringMatching(/^\$2[aby]\$/),
        },
      });

      // Valida que a senha salva realmente corresponde à nova senha via bcrypt
      const savedHash = prisma.users.update.mock.calls[0][0].data.password;
      const isMatch = await bcrypt.compare('MinhaNovaSenha@2026', savedHash);
      expect(isMatch).toBe(true);

      // Valida auditoria com id_condominio real
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id_condominio: 15,
          usuario_nome: 'Morador João',
          usuario_email: 'joao@morador.com',
          entidade_id: 55,
          ip: '189.10.20.30',
        }),
      });
    });

    it('redefine senha de Funcionário com hash bcrypt na tabela Funcionarios_Portaria e grava auditoria', async () => {
      const rawToken = 'token-porteiro';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      prisma.redefinicoes_Senha.updateMany.mockResolvedValue({ count: 1 });
      prisma.redefinicoes_Senha.findFirst.mockResolvedValue({
        id: 102,
        papel: 'funcionario',
        id_conta: 77,
        token_hash: tokenHash,
        expira_em: new Date(Date.now() + 15 * 60 * 1000),
        usado_em: new Date(),
        ip: '200.50.60.70',
      });

      prisma.funcionarios_Portaria.findFirst.mockResolvedValue({
        id: 77,
        id_condominio: 8,
        nome: 'Porteiro Marcos',
        login: 'porteiro_marcos',
        email: 'marcos@portaria.com',
      });
      prisma.funcionarios_Portaria.update.mockResolvedValue({ id: 77 });

      const res = await service.confirmarRedefinicaoSenha(rawToken, 'SenhaFortePorteiro123');

      expect(res.success).toBe(true);
      expect(prisma.funcionarios_Portaria.update).toHaveBeenCalledWith({
        where: { id: 77 },
        data: {
          password: expect.stringMatching(/^\$2[aby]\$/),
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id_condominio: 8,
          usuario_nome: 'Porteiro Marcos',
          usuario_email: 'marcos@portaria.com',
          entidade_id: 77,
          ip: '200.50.60.70',
        }),
      });
    });

    it('redefine senha de Síndico e registra id_condominio real na auditoria', async () => {
      const rawToken = 'token-sindico';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      prisma.redefinicoes_Senha.updateMany.mockResolvedValue({ count: 1 });
      prisma.redefinicoes_Senha.findFirst.mockResolvedValue({
        id: 103,
        papel: 'sindico',
        id_conta: 10,
        token_hash: tokenHash,
        expira_em: new Date(Date.now() + 15 * 60 * 1000),
        usado_em: new Date(),
        ip: '177.10.20.30',
      });
      prisma.sindicos_Condominios.findFirst.mockResolvedValue({ id_condominio: 99 });
      prisma.users.findUnique.mockResolvedValue({ name: 'Síndico Fernando', email: 'fernando@sindico.com' });
      prisma.users.update.mockResolvedValue({ id: 10 });

      const res = await service.confirmarRedefinicaoSenha(rawToken, 'SenhaSuperSegura2026!');

      expect(res.success).toBe(true);
      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: {
          password: expect.stringMatching(/^\$2[aby]\$/),
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id_condominio: 99,
          usuario_nome: 'Síndico Fernando',
          usuario_email: 'fernando@sindico.com',
          entidade_id: 10,
          ip: '177.10.20.30',
        }),
      });
    });
  });

  describe('Recuperação de Senha por Código de 6 Dígitos no App Mobile', () => {
    it('solicitarCodigoRedefinicao: gera código de 6 dígitos, hash bcrypt, ticket_id e envia e-mail para morador', async () => {
      mail.sendResetPasswordCode = jest.fn().mockResolvedValue(undefined);
      prisma.users.findFirst.mockResolvedValue({
        id: 55,
        login: 'morador@click.com',
        moradores: [{ id: 12, nome: 'João Morador', id_condominio: 3 }],
      });
      prisma.redefinicoes_Senha.updateMany.mockResolvedValue({ count: 0 });
      prisma.redefinicoes_Senha.create.mockResolvedValue({ id: 201 });

      const res = await service.solicitarCodigoRedefinicao('morador@click.com', 'morador', '189.100.86.130');

      expect(res.success).toBe(true);
      expect(res.ticket_id).toBeDefined();
      expect(res.email_masked).toBe('mo****@click.com');
      expect(res.expira_em_segundos).toBe(600);

      expect(prisma.redefinicoes_Senha.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id_conta: 55,
          papel: 'morador',
          ticket_id: expect.any(String),
          codigo_hash: expect.stringMatching(/^\$2[aby]\$/),
          tentativas: 0,
          expira_em: expect.any(Date),
          ip: '189.100.86.130',
        }),
      });
    });

    it('solicitarCodigoRedefinicao: retorna sucesso fictício quando conta não existe (anti-timing e anti-enumeração)', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      const res = await service.solicitarCodigoRedefinicao('fantasma@click.com', 'morador');

      expect(res.success).toBe(true);
      expect(res.ticket_id).toBeDefined();
      expect(res.email_masked).toBe('fa****@click.com');
      expect(prisma.redefinicoes_Senha.create).not.toHaveBeenCalled();
    });

    it('validarCodigoRedefinicao: lança erro se ticket não existir ou estiver expirado', async () => {
      prisma.redefinicoes_Senha.findFirst.mockResolvedValue(null);

      await expect(service.validarCodigoRedefinicao('ticket-invalido', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('validarCodigoRedefinicao: bloqueia e lança 429 se tentativas >= 5', async () => {
      prisma.redefinicoes_Senha.findFirst.mockResolvedValue({
        id: 301,
        ticket_id: 'ticket-123',
        tentativas: 5,
        codigo_hash: await bcrypt.hash('123456', 10),
      });

      await expect(service.validarCodigoRedefinicao('ticket-123', '123456')).rejects.toThrow(
        'Muitas tentativas incorretas. O código foi invalidado por segurança.',
      );
    });

    it('validarCodigoRedefinicao: incrementa tentativas e informa restante se código incorreto', async () => {
      const hash = await bcrypt.hash('654321', 10);
      prisma.redefinicoes_Senha.findFirst.mockResolvedValue({
        id: 302,
        ticket_id: 'ticket-123',
        tentativas: 1,
        codigo_hash: hash,
      });

      await expect(service.validarCodigoRedefinicao('ticket-123', '000000')).rejects.toThrow(
        'Código incorreto. Restam 3 tentativa(s).',
      );

      expect(prisma.redefinicoes_Senha.update).toHaveBeenCalledWith({
        where: { id: 302 },
        data: { tentativas: { increment: 1 } },
      });
    });

    it('validarCodigoRedefinicao: emite reset_token quando código de 6 dígitos estiver correto', async () => {
      const hash = await bcrypt.hash('889900', 10);
      prisma.redefinicoes_Senha.findFirst.mockResolvedValue({
        id: 303,
        ticket_id: 'ticket-correto',
        tentativas: 0,
        codigo_hash: hash,
      });
      prisma.redefinicoes_Senha.update.mockResolvedValue({ id: 303 });

      const res = await service.validarCodigoRedefinicao('ticket-correto', '889900');

      expect(res.success).toBe(true);
      expect(res.reset_token).toBeDefined();
      expect(prisma.redefinicoes_Senha.update).toHaveBeenCalledWith({
        where: { id: 303 },
        data: expect.objectContaining({
          verificado_em: expect.any(Date),
          reset_token_hash: expect.any(String),
        }),
      });
    });

    it('confirmarRedefinicaoSenha: aceita reset_token gerado pelo código e retorna payload de auto-login', async () => {
      const resetToken = 'reset-token-valido-123';
      const resetTokenHash = createHash('sha256').update(resetToken).digest('hex');

      prisma.redefinicoes_Senha.updateMany.mockResolvedValue({ count: 1 });
      prisma.redefinicoes_Senha.findFirst.mockResolvedValue({
        id: 401,
        papel: 'morador',
        id_conta: 77,
        reset_token_hash: resetTokenHash,
        token_hash: null,
        expira_em: new Date(Date.now() + 10 * 60 * 1000),
      });
      prisma.users.findUnique.mockResolvedValue({ id: 77, name: 'Morador Logado', email: 'morador@click.com', photo: '' });
      prisma.moradores.findFirst.mockResolvedValue({ id: 10, nome: 'Morador Logado', id_condominio: 5 });
      prisma.users.update.mockResolvedValue({ id: 77 });

      const res = await service.confirmarRedefinicaoSenha(resetToken, 'NovaSenha@2026', 'morador');

      expect(res.success).toBe(true);
      expect(res.token).toBeDefined();
      expect(res.user).toBeDefined();
      expect(res.user.nome).toBe('Morador Logado');
      expect(prisma.users.update).toHaveBeenCalled();
    });
  });
});


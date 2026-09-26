import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from './mail.service';

describe('MailService - sendResetPasswordCode', () => {
  let service: MailService;
  let sendSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MailService],
    }).compile();

    service = module.get<MailService>(MailService);
    // Intercepta o método privado send para validar parâmetros gerados
    sendSpy = jest.spyOn<any, any>(service, 'send').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve disparar e-mail com código de 6 dígitos formatado e assunto correto', async () => {
    await service.sendResetPasswordCode('morador@click.com', 'Vinicius Rufini', '482910', 'Morador');

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [to, subject, html, text] = sendSpy.mock.calls[0];

    expect(to).toBe('morador@click.com');
    expect(subject).toBe('Código para redefinição de senha: 482910 - PRESTARE');
    expect(html).toContain('482910');
    expect(html).toContain('Vinicius Rufini');
    expect(html).toContain('Morador');
    expect(html).toContain('10 minutos');
    expect(text).toContain('482910');
    expect(text).toContain('10 minutos');
  });

  it('deve escapar caracteres HTML maliciosos no nome e tipo de usuário', async () => {
    await service.sendResetPasswordCode(
      'morador@click.com',
      '<script>alert("xss")</script>',
      '123456',
      '<b>Hacker</b>',
    );

    const [, , html] = sendSpy.mock.calls[0];
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<b>Hacker</b>');
    expect(html).toContain('&lt;b&gt;Hacker&lt;/b&gt;');
  });

  it('deve emitir o link de redefinição no domínio público oficial', async () => {
    await service.sendResetPasswordLink('morador@click.com', 'token com espaço', 'Morador');

    const [, , html, text] = sendSpy.mock.calls[0];
    const expectedLink = 'https://www.prestarecondominios.com.br/?redefinir-senha=token%20com%20espa%C3%A7o';

    expect(html).toContain(expectedLink);
    expect(text).toContain(expectedLink);
    expect(html).not.toContain('https://www.clickprestarecondominios.com.br');
    expect(text).not.toContain('https://www.clickprestarecondominios.com.br');
  });
});

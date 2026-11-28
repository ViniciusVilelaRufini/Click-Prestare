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

describe('MailService - log do envio não grava o e-mail completo', () => {
  const EMAIL = 'ana.operadora@prestare.test';

  function build() {
    const service = new MailService();
    const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    (service as any).logger = logger;
    const textos = () => [...logger.log.mock.calls, ...logger.error.mock.calls].map((c) => String(c[0])).join('\n');
    return { service, logger, textos };
  }

  it('Resend: sucesso e falha registram o destinatário mascarado', async () => {
    const { service, textos } = build();
    const send = jest
      .fn()
      .mockResolvedValueOnce({ data: { id: 'abc' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { name: 'x', message: 'recusado' } });
    (service as any).resend = { emails: { send } };
    await (service as any).send(EMAIL, 'Assunto', '<p>oi</p>');
    await expect((service as any).send(EMAIL, 'Assunto', '<p>oi</p>')).rejects.toThrow();
    expect(send.mock.calls[0][0].to).toEqual([EMAIL]);
    expect(textos()).not.toContain(EMAIL);
    expect(textos()).toContain('an***@prestare.test');
  });

  it('SMTP: sucesso e falha registram o destinatário mascarado', async () => {
    const { service, textos } = build();
    const sendMail = jest.fn().mockResolvedValueOnce({ messageId: 'm1' }).mockRejectedValueOnce(new Error('caiu'));
    (service as any).resend = null;
    (service as any).transporter = { sendMail };
    await (service as any).send(EMAIL, 'Assunto', '<p>oi</p>');
    await expect((service as any).send(EMAIL, 'Assunto', '<p>oi</p>')).rejects.toThrow('caiu');
    expect(sendMail.mock.calls[0][0].to).toBe(EMAIL);
    expect(textos()).not.toContain(EMAIL);
    expect(textos()).toContain('an***@prestare.test');
  });

  it('sem serviço configurado: o erro também sai mascarado', async () => {
    const { service, textos } = build();
    (service as any).resend = null;
    (service as any).transporter = null;
    await expect((service as any).send(EMAIL, 'Assunto', '<p>oi</p>')).rejects.toThrow();
    expect(textos()).not.toContain(EMAIL);
    expect(textos()).toContain('an***@prestare.test');
  });
});

import { MailService } from './mail.service';

describe('MailService SMTP configuration', () => {
  const smtpEnvironmentNames = ['SMTP_USER', 'SMTP_PASS'] as const;
  const originalEnvironment = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of smtpEnvironmentNames) {
      originalEnvironment.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of smtpEnvironmentNames) {
      const originalValue = originalEnvironment.get(name);
      if (originalValue === undefined) delete process.env[name];
      else process.env[name] = originalValue;
    }
    originalEnvironment.clear();
  });

  it('does not supply SMTP credentials when they are absent from the environment', () => {
    const service = new MailService();

    expect((service as any).smtpUser).toBeUndefined();
    expect((service as any).smtpPass).toBeUndefined();
  });
});

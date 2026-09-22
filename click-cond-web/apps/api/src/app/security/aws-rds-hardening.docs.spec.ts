import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryFile = (...segments: string[]) =>
  resolve(__dirname, '../../../../../', ...segments);

describe('AWS/RDS hardening runbook', () => {
  const hardeningRunbook = repositoryFile('docs', 'security', 'AWS_RDS_HARDENING.md');
  const secretsRunbook = repositoryFile('docs', 'security', 'ROTACAO_DE_SEGREDOS.md');

  it('documents every required control without embedding a database connection string', () => {
    expect(existsSync(hardeningRunbook)).toBe(true);

    const content = readFileSync(hardeningRunbook, 'utf8');
    for (const requiredControl of [
      'snapshot',
      'VPC',
      'Security Group',
      'require_secure_transport',
      'local_infile',
      'CloudWatch',
      'least privilege',
      'TLS',
      'rollback',
    ]) {
      expect(content).toContain(requiredControl);
    }

    expect(content).not.toMatch(/mysql(?:\+[^:]*)?:\/\//i);
  });

  it('requires immediate revocation when a database credential was exposed', () => {
    const content = readFileSync(secretsRunbook, 'utf8');

    expect(content).toMatch(/credencial exposta/i);
    expect(content).toMatch(/imediat/i);
    expect(content).toMatch(/revog/i);
  });
});

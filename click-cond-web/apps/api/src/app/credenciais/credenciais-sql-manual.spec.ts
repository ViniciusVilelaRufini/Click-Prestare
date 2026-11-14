/**
 * A migração manual das credenciais roda à mão no RDS antes do deploy. O
 * ALTER da opção "QR no app" não pode depender de outra coluna existir
 * (`AFTER <coluna>` falha com "Unknown column" num banco em que ela não foi
 * criada) e precisa continuar idempotente.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(__dirname, '../../../../../prisma/manual_2026-11_credenciais_acesso.sql'),
  'utf8',
);

describe('manual_2026-11_credenciais_acesso.sql', () => {
  const alter = /ALTER TABLE Condominios ADD COLUMN qr_app_habilitado[^']*/.exec(SQL)?.[0] ?? '';

  it('acrescenta qr_app_habilitado sem posicionar depois de outra coluna', () => {
    expect(alter).toMatch(/TINYINT\(1\) NOT NULL DEFAULT 0/);
    expect(alter).not.toMatch(/\bAFTER\b/i);
    expect(alter).not.toMatch(/\bFIRST\b/i);
  });

  it('só roda o ALTER se a coluna ainda não existe (idempotente)', () => {
    expect(SQL).toMatch(
      /IF\(\s*EXISTS \(\s*SELECT 1 FROM information_schema\.COLUMNS[\s\S]*?COLUMN_NAME = 'qr_app_habilitado'[\s\S]*?\),\s*'SELECT 1',\s*'ALTER TABLE Condominios ADD COLUMN qr_app_habilitado/,
    );
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS Credenciais_Acesso/);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS Credenciais_Leituras/);
  });
});

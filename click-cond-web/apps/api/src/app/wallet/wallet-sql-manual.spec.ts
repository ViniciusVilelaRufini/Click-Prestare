/**
 * A migração manual da carteira roda à mão no RDS antes do deploy, depois da
 * do QR dinâmico. Tem de ser idempotente, sem `AFTER <coluna>`, e parar com
 * mensagem clara se Credenciais_Acesso ainda não existir.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(resolve(__dirname, '../../../../../prisma/manual_2026-11_wallet.sql'), 'utf8');

describe('manual_2026-11_wallet.sql', () => {
  it('as duas colunas novas só entram se ainda não existem, sem AFTER/FIRST', () => {
    for (const [tabela, coluna, tipo] of [
      ['Condominios', 'wallet_habilitado', 'TINYINT\\(1\\) NOT NULL DEFAULT 0'],
      ['Credenciais_Acesso', 'wallet_atualizado_em', 'DATETIME\\(3\\) NULL'],
    ]) {
      expect(SQL).toMatch(
        new RegExp(
          `IF\\(\\s*EXISTS \\(\\s*SELECT 1 FROM information_schema\\.COLUMNS[\\s\\S]*?TABLE_NAME = '${tabela}'[\\s\\S]*?COLUMN_NAME = '${coluna}'[\\s\\S]*?\\),\\s*'SELECT 1',\\s*'ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}'`,
        ),
      );
    }
    const alters = SQL.match(/'ALTER TABLE [^']*'/g) ?? [];
    expect(alters).toHaveLength(2);
    for (const a of alters) {
      expect(a).not.toMatch(/\bAFTER\b/i);
      expect(a).not.toMatch(/\bFIRST\b/i);
    }
  });

  it('cria Wallet_Registros com IF NOT EXISTS, chave única, índice e FK em cascata', () => {
    const tabela = /CREATE TABLE IF NOT EXISTS Wallet_Registros \(([\s\S]*?)\) ENGINE/.exec(SQL)?.[1] ?? '';
    expect(tabela).toMatch(/UNIQUE KEY un_walreg \(device_id, id_credencial\)/);
    expect(tabela).toMatch(/KEY idx_walreg_cred \(id_credencial\)/);
    expect(tabela).toMatch(
      /CONSTRAINT fk_walreg_cred FOREIGN KEY \(id_credencial\) REFERENCES Credenciais_Acesso\(id\) ON DELETE CASCADE/,
    );
    expect(tabela).toMatch(/device_id VARCHAR\(100\) NOT NULL/);
    expect(tabela).toMatch(/push_token VARCHAR\(200\) NOT NULL/);
  });

  it('falha com mensagem clara, antes de tudo, se Credenciais_Acesso não existir', () => {
    const guarda = SQL.indexOf("TABLE_NAME = 'Credenciais_Acesso'");
    expect(guarda).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(SQL.indexOf('ALTER TABLE'));
    expect(SQL).toMatch(/information_schema\.TABLES[\s\S]*?'SELECT 1 FROM `ERRO: rode antes manual_2026-11_credenciais_acesso\.sql`'/);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEncryptedDump,
  resolveBackupDirectory,
  verifyDumpForWipe,
} from './dump-database.mjs';
import { assertWipeDatabaseAllowed } from './wipe-test-data.mjs';

const KEY = 'a'.repeat(64);
const NOW = new Date('2026-09-22T12:00:00.000Z');

test('rejects a production process even when its database name appears in an allowlist', () => {
  assert.throws(
    () => assertWipeDatabaseAllowed('click_cond_test', { nodeEnv: 'production' }),
    /produ..o/i,
  );
});

test('rejects a database that is not in the explicit wipe allowlist', () => {
  assert.throws(
    () => assertWipeDatabaseAllowed('customer_database', { nodeEnv: 'test' }),
    /allowlist/i,
  );
});

test('stores database rows inside an authenticated encrypted dump envelope', () => {
  const envelope = createEncryptedDump(
    {
      geradoEm: NOW.toISOString(),
      database: 'click_cond_test',
      contagens: { Users: 1 },
      dados: { Users: [{ email: 'pessoa@example.com' }] },
    },
    KEY,
  );
  const serialized = JSON.stringify(envelope);

  assert.equal(envelope.algorithm, 'aes-256-gcm');
  assert.match(envelope.ciphertext, /^[A-Za-z0-9+/=]+$/);
  assert.doesNotMatch(serialized, /pessoa@example\.com/);
});

test('accepts only a recent verified dump for the exact target database', () => {
  const envelope = createEncryptedDump(
    {
      geradoEm: NOW.toISOString(),
      database: 'click_cond_test',
      contagens: { Users: 1 },
      dados: { Users: [{ id: 1 }] },
    },
    KEY,
  );

  assert.deepEqual(
    verifyDumpForWipe(envelope, KEY, 'click_cond_test', NOW),
    { Users: 1 },
  );
  assert.throws(
    () => verifyDumpForWipe(envelope, KEY, 'another_database', NOW),
    /banco alvo/i,
  );
  assert.throws(
    () => verifyDumpForWipe(envelope, KEY, 'click_cond_test', new Date('2026-09-22T12:31:00.000Z')),
    /recente/i,
  );
});

test('resolves the backup directory from the dump module rather than the caller cwd', () => {
  assert.match(resolveBackupDirectory(), /click-cond-web[\\/]backups$/);
});

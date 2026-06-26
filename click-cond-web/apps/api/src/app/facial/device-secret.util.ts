import * as crypto from 'crypto';

/**
 * Cifragem em repouso das credenciais de dispositivo (api_password).
 *
 * AES-256-GCM (autenticado) com chave derivada de FACIAL_CRED_KEY (preferido)
 * ou JWT_SECRET. Formato: "enc:v1:" + base64(iv[12] | tag[16] | ciphertext).
 *
 * Retrocompatível por design — NÃO quebra um ambiente já em produção:
 *   - valor sem o prefixo "enc:v1:" é tratado como texto puro legado e devolvido
 *     como está (linhas antigas continuam funcionando);
 *   - sem chave no ambiente, encrypt devolve o texto puro (não cifra) — assim
 *     dev/local segue funcionando e produção (com JWT_SECRET) cifra de verdade.
 *
 * A cifragem protege o dump do banco. Não muda quem já podia ler a senha via API
 * autenticada (síndico) — esse continua sendo o mesmo modelo de confiança.
 */
const PREFIX = 'enc:v1:';

function key(): Buffer | null {
  const secret = process.env.FACIAL_CRED_KEY || process.env.JWT_SECRET;
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest(); // 32 bytes
}

export function encryptSecret(
  plain: string | null | undefined,
): string | null {
  if (plain == null || plain === '') return plain ?? null;
  if (plain.startsWith(PREFIX)) return plain; // já cifrado — não recifra
  const k = key();
  if (!k) return plain; // sem chave: mantém texto puro (não derruba o ambiente)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(
  stored: string | null | undefined,
): string | null {
  if (stored == null) return null;
  if (!stored.startsWith(PREFIX)) return stored; // legado em texto puro
  const k = key();
  if (!k) return stored; // sem chave para decifrar — devolve como está
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    // Chave trocada / dado corrompido: devolve cru para não derrubar o fluxo.
    return stored;
  }
}

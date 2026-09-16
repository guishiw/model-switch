import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/** 32-byte key from env (base64) or derived from JWT secret as a fallback */
function key(): Buffer {
  const raw = process.env.API_KEY_ENCRYPTION_KEY;
  if (raw) {
    const b = Buffer.from(raw, 'base64');
    if (b.length !== 32) throw new Error('API_KEY_ENCRYPTION_KEY must be 32 bytes base64');
    return b;
  }
  return createHash('sha256').update(process.env.ADMIN_JWT_SECRET ?? 'dev').digest();
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

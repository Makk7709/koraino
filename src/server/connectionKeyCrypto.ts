import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Clé fournie par Lovable (APP_USER_CONNECTION_KEY_SECRET, base64, 32 octets),
 * lue uniquement côté serveur. Lecture dans la fonction, jamais au niveau module.
 */
function key(): Buffer {
  const raw = process.env['APP_USER_CONNECTION_KEY_SECRET'];
  if (!raw) throw new Error("APP_USER_CONNECTION_KEY_SECRET is not set");
  return Buffer.from(raw, "base64");
}

export function encryptConnectionKey(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  // iv | tag | ciphertext, base64 — valeur opaque en base.
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptConnectionKey(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

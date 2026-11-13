import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Clé fournie par Lovable (APP_USER_CONNECTION_KEY_SECRET, base64, 32 octets),
 * lue uniquement côté serveur. Lecture dans la fonction, jamais au niveau module.
 */
function key(): Buffer {
  const raw = process.env["APP_USER_CONNECTION_KEY_SECRET"];
  if (!raw) throw new Error("APP_USER_CONNECTION_KEY_SECRET is not set");
  return Buffer.from(raw, "base64");
}

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encryptConnectionKey(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key(), iv, { authTagLength: TAG_LENGTH });
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  // iv | tag | ciphertext, base64 — valeur opaque en base.
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptConnectionKey(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  // Une valeur plus courte donnerait un tag tronqué, que GCM accepte dès 4 octets.
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Connection key ciphertext is too short");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ct = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

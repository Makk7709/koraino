import { createCipheriv } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptConnectionKey, encryptConnectionKey } from "@/server/connectionKeyCrypto";

const SECRET = Buffer.alloc(32, 7);
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const bytes = (stored: string) => Buffer.from(stored, "base64");
const stored = (buf: Buffer) => buf.toString("base64");

beforeEach(() => {
  vi.stubEnv("APP_USER_CONNECTION_KEY_SECRET", SECRET.toString("base64"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chiffrement de la clé de connexion (AES-256-GCM)", () => {
  it("une clé chiffrée se relit à l'identique", () => {
    expect(decryptConnectionKey(encryptConnectionKey("lovack_cle_de_test"))).toBe(
      "lovack_cle_de_test",
    );
  });

  it("la valeur stockée garde la forme iv (12) | tag (16) | chiffré", () => {
    const plaintext = "lovack_cle_de_test";
    expect(bytes(encryptConnectionKey(plaintext))).toHaveLength(
      IV_LENGTH + TAG_LENGTH + Buffer.byteLength(plaintext),
    );
  });

  it("une valeur chiffrée sans longueur de tag déclarée reste lisible", () => {
    const iv = Buffer.alloc(IV_LENGTH, 3);
    const cipher = createCipheriv("aes-256-gcm", SECRET, iv);
    const ct = Buffer.concat([cipher.update("cle_existante", "utf8"), cipher.final()]);
    const existing = stored(Buffer.concat([iv, cipher.getAuthTag(), ct]));
    expect(decryptConnectionKey(existing)).toBe("cle_existante");
  });

  it.each([4, 8, 12, 15])("un tag tronqué à %i octets est refusé", (length) => {
    // Chiffré vide : iv | tag. Tronquer la valeur raccourcit donc le tag lui-même.
    const full = bytes(encryptConnectionKey(""));
    expect(full).toHaveLength(IV_LENGTH + TAG_LENGTH);
    const truncated = stored(full.subarray(0, IV_LENGTH + length));
    expect(() => decryptConnectionKey(truncated)).toThrow();
  });

  it("une valeur vide ou plus courte que l'iv est refusée", () => {
    expect(() => decryptConnectionKey("")).toThrow();
    expect(() => decryptConnectionKey(stored(Buffer.alloc(IV_LENGTH - 1, 1)))).toThrow();
  });

  it("un tag altéré est refusé", () => {
    const buf = bytes(encryptConnectionKey("lovack_cle_de_test"));
    buf[IV_LENGTH] = (buf[IV_LENGTH] ?? 0) ^ 0x01;
    expect(() => decryptConnectionKey(stored(buf))).toThrow();
  });

  it("un chiffré altéré est refusé", () => {
    const buf = bytes(encryptConnectionKey("lovack_cle_de_test"));
    const last = buf.length - 1;
    buf[last] = (buf[last] ?? 0) ^ 0x01;
    expect(() => decryptConnectionKey(stored(buf))).toThrow();
  });
});

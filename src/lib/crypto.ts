import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";

/**
 * Password hashing and token generation.
 *
 * I use scrypt from node:crypto rather than pulling in bcrypt. scrypt is
 * memory-hard, ships with the runtime, and needs no native build. The stored
 * format is `scrypt$N$r$p$salt$hash`, all hex, so the parameters travel with
 * the hash and can be tuned without a data migration.
 */

const N = 16384; // CPU/memory cost
const r = 8; // block size
const p = 1; // parallelisation
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LEN, { N, r, p });
  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = scryptSync(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Opaque, URL-safe session token with high entropy. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newId(): string {
  return randomUUID();
}

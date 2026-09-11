import { randomBytes, randomInt, scryptSync } from "node:crypto";

// Node's built-in crypto rather than bcrypt/argon2: no native binary for the
// desktop build to unpack, matching the rest of the app's images/*, ico.ts
// (see lib/images/ico.ts).

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

/**
 * scrypt$N$saltHex$hashHex — self-describing so `N` can change later without
 * invalidating hashes already stored.
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, SCRYPT_KEYLEN, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const PASSWORD_LENGTH = 12;

/** A one-time temporary password, shown to the admin once and never stored in the clear. */
export function generateTemporaryPassword(): string {
  let password = "";
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    password += PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)];
  }
  return password;
}

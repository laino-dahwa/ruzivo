import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

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

/**
 * Checks a password against a stored `scrypt$N$salt$hash` string.
 *
 * `N` is read back from the stored value rather than assumed, so hashes
 * written under an older cost factor keep verifying after SCRYPT_N changes.
 * A malformed or unrecognised stored value is a failed verification, never a
 * thrown error — a corrupt row must not turn a login into a 500.
 */
export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") {
    return false;
  }

  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost < 2) {
    return false;
  }

  const salt = Buffer.from(parts[2], "hex");
  const expected = Buffer.from(parts[3], "hex");
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }

  let derived: Buffer;
  try {
    derived = scryptSync(plain, salt, expected.length, { N: cost });
  } catch {
    // An absurd cost factor can exceed scrypt's memory ceiling.
    return false;
  }

  return timingSafeEqual(derived, expected);
}

// Derived once, lazily, from a password nobody knows. Only ever used to burn
// the same ~80ms a real verification costs.
let dummyHash: string | null = null;

/**
 * Spends the same time a real password check would, and reports nothing.
 *
 * Call this on the login path when no account matches the submitted email.
 * Without it, "unknown email" returns measurably faster than "wrong
 * password", which is enough to enumerate who has an account.
 */
export function burnVerificationTime(plain: string): void {
  if (dummyHash === null) {
    dummyHash = hashPassword(generateTemporaryPassword());
  }
  verifyPassword(plain, dummyHash);
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

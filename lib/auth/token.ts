import { createHash, randomBytes } from "node:crypto";

/**
 * Session tokens: 256 bits of randomness, stored only as a SHA-256 digest.
 *
 * Deliberately NOT scrypt, unlike lib/auth/password.ts. A password is short,
 * human-chosen and drawn from a guessable distribution, so it needs a slow
 * KDF to make offline cracking expensive. A session token is 256 uniformly
 * random bits — there is no dictionary to try, and no amount of stretching
 * makes brute force any less hopeless than it already is. Running a KDF here
 * would instead add ~80ms to *every authenticated request in the app*.
 *
 * Hashing at rest still matters: a leaked database backup must not hand
 * anyone a working session.
 */

const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  // base64url: safe to put in a cookie without escaping.
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

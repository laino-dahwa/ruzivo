import { randomInt } from "node:crypto";

/**
 * Security keys — the "forgot my password" path that needs no administrator.
 *
 * 24 characters from a 31-character alphabet (no 0/O or 1/I/L, so it can be
 * read off paper without guessing) is about 119 bits: far beyond guessing,
 * especially behind the same 5-attempt lockout as passwords. Shown in groups
 * of four.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const KEY_LENGTH = 24;
const GROUP = 4;

/** e.g. "7KQ4-M9XD-2HTP-WC8N-R3VF-JY6A" */
export function generateSecurityKey(): string {
  let raw = "";
  for (let i = 0; i < KEY_LENGTH; i++) {
    raw += ALPHABET[randomInt(ALPHABET.length)];
  }
  return raw.match(new RegExp(`.{1,${GROUP}}`, "g"))!.join("-");
}

/**
 * The form a key is hashed and compared in: upper case, dashes and spaces
 * dropped — so "7kq4 m9xd…" typed by hand matches "7KQ4-M9XD-…" as issued.
 */
export function normaliseSecurityKey(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

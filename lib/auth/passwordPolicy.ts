/**
 * Password rules for passwords a human chooses (bootstrap and change-password).
 *
 * Deliberately modest: length plus a refusal of the handful of passwords
 * everybody tries first. Composition rules ("one capital, one symbol") push
 * people toward Password1! and are not worth the friction on an offline,
 * single-machine app where the realistic threat is a colleague guessing,
 * not an internet-scale credential-stuffing attack.
 */

export const MIN_PASSWORD_LENGTH = 10;

const OBVIOUS = new Set([
  "password",
  "password1",
  "password123",
  "passw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "letmein123",
  "administrator",
  "adminadmin",
  "school123",
  "welcome123",
  "changeme123",
]);

/** Returns an error message, or null when the password is acceptable. */
export function validatePassword(password: string, context: { email?: string; firstName?: string; lastName?: string } = {}): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (password.length > 200) {
    return "Password must be 200 characters or fewer.";
  }

  const normalised = password.trim().toLowerCase();

  if (OBVIOUS.has(normalised)) {
    return "That password is too easy to guess. Choose something else.";
  }

  if (/^(.)\1+$/.test(normalised)) {
    return "That password is too easy to guess. Choose something else.";
  }

  // A password that is just the person's own name or login is guessable by
  // anyone who can see the staff list.
  for (const value of [context.email, context.firstName, context.lastName]) {
    if (value && value.trim().length >= 3 && normalised === value.trim().toLowerCase()) {
      return "Your password must not be your name or email address.";
    }
  }

  return null;
}

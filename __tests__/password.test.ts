import { describe, expect, it } from "vitest";
import { scryptSync } from "node:crypto";
import { burnVerificationTime, generateTemporaryPassword, hashPassword, verifyPassword } from "../lib/auth/password";

describe("password hashing and verification", () => {
  it("accepts the password it hashed", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("Correct horse battery staple", hash)).toBe(false);
    expect(verifyPassword("", hash)).toBe(false);
  });

  it("produces a different hash each time, so equal passwords are not detectable", () => {
    // Different random salt per call — two people choosing the same password
    // must not end up with the same stored string.
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("stores the cost factor so old hashes keep verifying after it changes", () => {
    const hash = hashPassword("whatever");
    const [scheme, cost, salt, derived] = hash.split("$");
    expect(scheme).toBe("scrypt");
    expect(Number(cost)).toBeGreaterThan(1);
    expect(salt).toMatch(/^[0-9a-f]+$/);
    expect(derived).toMatch(/^[0-9a-f]+$/);

    // A hash written under a lower cost factor still verifies, because the
    // cost is read back from the stored string rather than assumed.
    const cheaper = scryptSync("whatever", Buffer.from(salt, "hex"), 64, { N: 1024 }).toString("hex");
    expect(verifyPassword("whatever", `scrypt$1024$${salt}$${cheaper}`)).toBe(true);
  });

  it("treats a malformed stored value as a failed check, never an exception", () => {
    // A corrupt row must not turn a login into a 500.
    for (const malformed of ["", "not-a-hash", "scrypt$$$", "scrypt$abc$aa$bb", "bcrypt$16384$aa$bb", "scrypt$16384$zz$zz", "scrypt$16384$aa"]) {
      expect(() => verifyPassword("anything", malformed)).not.toThrow();
      expect(verifyPassword("anything", malformed)).toBe(false);
    }
  });

  it("burns comparable time when no account matches, so a missing email is not detectable", () => {
    const hash = hashPassword("a real password");

    const realStart = process.hrtime.bigint();
    verifyPassword("a wrong password", hash);
    const realMs = Number(process.hrtime.bigint() - realStart) / 1e6;

    burnVerificationTime("warm up the lazy dummy hash");

    const dummyStart = process.hrtime.bigint();
    burnVerificationTime("a wrong password");
    const dummyMs = Number(process.hrtime.bigint() - dummyStart) / 1e6;

    // Generous bounds — this asserts the same order of magnitude of work, not
    // a precise timing guarantee, which a shared CI runner cannot provide.
    expect(dummyMs).toBeGreaterThan(realMs / 10);
    expect(dummyMs).toBeLessThan(realMs * 10);
  });
});

describe("temporary passwords", () => {
  it("avoids characters that are misread when typed off a screen", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateTemporaryPassword()).not.toMatch(/[IOl01o]/);
    }
  });

  it("is long enough and not repeated", () => {
    const generated = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword()));
    expect(generated.size).toBe(50);
    for (const password of generated) {
      expect(password).toHaveLength(12);
    }
  });
});

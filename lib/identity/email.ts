// Shared "first initial + surname @ school" address format used for both
// employees (repositories/employee/create) and learners
// (repositories/learner/create). Kept in one place so the two never drift.

/** "John" "O'Doe" -> "jodoe" — punctuation stripped so the local part stays a valid address. */
function localPart(firstName: string, lastName: string): string {
  const initial = firstName.trim().slice(0, 1).toLowerCase();
  const surname = lastName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${initial}${surname}`;
}

/** school_id is CHAR(4) and arrives blank-padded from Postgres; trimmed before it becomes a domain. */
function domain(schoolId: string): string {
  return `${schoolId.trim().toLowerCase()}.school`;
}

/**
 * Builds an address in the "jdoe@sch1.school" format and makes it unique
 * against `taken` (every email already used at this school, plus every one
 * assigned earlier in the same batch) by appending an incrementing number —
 * "jdoe2@sch1.school" — the same convention as most real mail systems.
 *
 * Mutates `taken`, adding the address it returns, so a caller can fold this
 * over a whole batch and never hand out the same address twice.
 */
export function generateUniqueEmail(
  firstName: string,
  lastName: string,
  schoolId: string,
  taken: Set<string>
): string {
  const local = localPart(firstName, lastName);
  const at = domain(schoolId);

  let candidate = `${local}@${at}`;
  let suffix = 1;
  while (taken.has(candidate)) {
    candidate = `${local}${suffix}@${at}`;
    suffix += 1;
  }

  taken.add(candidate);
  return candidate;
}

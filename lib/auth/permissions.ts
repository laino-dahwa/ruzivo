/**
 * The single catalogue of who may do what.
 *
 * Imported by BOTH the server-side guard (lib/auth/guard.ts) and the
 * client-side nav/button gating, so the two can never drift into disagreeing
 * about a capability. Keep it free of server-only imports and database
 * lookups — it is plain data plus two pure functions.
 *
 * Client-side gating is a convenience only. Every capability here is
 * independently enforced on the server; hiding a button is not a control.
 */

export const ACCESS_LEVELS = ["ADMIN", "CASHIER"] as const;

export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export function isAccessLevel(value: unknown): value is AccessLevel {
  return typeof value === "string" && (ACCESS_LEVELS as readonly string[]).includes(value);
}

/**
 * Capability -> the access levels that hold it.
 *
 * Note `reference.read` vs `school.manage`. A cashier has no business on the
 * School setup page, but the Record Payment form cannot function without
 * reading income categories, payment periods, payment methods, academic years
 * and classes, and the shell needs the school's name and logo — all of which
 * live under the same /api/schools/[school_id]/** routes. Reads are shared;
 * every write is administrator-only.
 */
export const CAPABILITIES = {
  "overview.view": ["ADMIN"],

  "reference.read": ["ADMIN", "CASHIER"],
  "school.manage": ["ADMIN"],
  "school.create": ["ADMIN"],
  "school.delete": ["ADMIN"],
  "school.switch": ["ADMIN"],

  "learner.read": ["ADMIN", "CASHIER"],
  "learner.create": ["ADMIN", "CASHIER"],
  "learner.update": ["ADMIN"],
  "learner.delete": ["ADMIN"],

  "payment.read": ["ADMIN", "CASHIER"],
  "payment.create": ["ADMIN", "CASHIER"],
  "payment.delete": ["ADMIN"],

  "balance.read": ["ADMIN", "CASHIER"],
  "obligation.read": ["ADMIN", "CASHIER"],

  "expense.read": ["ADMIN", "CASHIER"],
  "expense.create": ["ADMIN", "CASHIER"],

  "report.read": ["ADMIN"],
  "user.manage": ["ADMIN"],
  "audit.read": ["ADMIN"],

  // Transfer letters and the like carry the school's authority, so issuing
  // them is administrator work even though a cashier can take money.
  "document.manage": ["ADMIN"],

  // Staff salaries are the most sensitive data in the app — visible to
  // administrators only, never to the person at the till.
  "payroll.manage": ["ADMIN"],
} as const satisfies Record<string, readonly AccessLevel[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(level: AccessLevel, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly AccessLevel[]).includes(level);
}

/**
 * The capability each page requires, so the nav filter and the page gate
 * agree without either restating the matrix.
 */
export const ROUTE_CAPABILITIES = {
  "/": "overview.view",
  "/school": "school.manage",
  "/learners": "learner.read",
  "/payments": "payment.read",
  "/owing": "balance.read",
  "/unpaid-mandatory": "obligation.read",
  "/learner-owings": "obligation.read",
  "/expenses": "expense.read",
  "/reports": "report.read",
  "/statements": "document.manage",
  "/payroll": "payroll.manage",
} as const satisfies Record<string, Capability>;

/** Where each level lands after signing in — the first page it is allowed to see. */
export const LANDING_ROUTE: Record<AccessLevel, string> = {
  ADMIN: "/",
  CASHIER: "/payments",
};

import { query, transaction } from "../../lib/db";
import { hashPassword } from "../../lib/auth/password";
import { generateUniqueEmail } from "../../lib/identity/email";
import { logAuditWithin } from "../audit/writeAuditLog";

export class BootstrapUnavailableError extends Error {
  constructor() {
    super("An administrator account already exists.");
    this.name = "BootstrapUnavailableError";
  }
}

export class BootstrapInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapInputError";
  }
}

const ADMIN_ROLE_NAME = "Administrator";

/**
 * Whether the app has been set up yet.
 *
 * "Set up" means exactly one thing: somebody holds a role at ADMIN level.
 * Deliberately not "are there any employees" — a database that already has
 * staff records (all of whom migration 006 landed at CASHIER) still needs its
 * first administrator.
 */
export async function hasAdministrator(): Promise<boolean> {
  const result = await query(
    `
    SELECT 1
    FROM employees e
    JOIN roles r ON r.role_id = e.role_id
    WHERE r.access_level = 'ADMIN'
      AND e.deleted_at IS NULL
    LIMIT 1
    `
  );
  return (result.rowCount ?? 0) > 0;
}

/** The schools the setup screen offers to attach the first administrator to. */
export async function listSchoolsForBootstrap(): Promise<{ school_id: string; school_name: string }[]> {
  const result = await query(`SELECT school_id, school_name FROM schools ORDER BY school_name`);
  return result.rows.map((row) => ({ school_id: row.school_id.trim(), school_name: row.school_name }));
}

export type BootstrapInput = {
  first_name: string;
  last_name: string;
  password: string;
  /** An existing school to join. */
  school_id?: string;
  /** Or a brand-new one, for a genuinely empty database. */
  new_school?: {
    school_id: string;
    school_name: string;
    school_type: string;
    school_address: string;
    school_contact: string;
    school_email: string;
  };
};

/**
 * Creates the very first administrator, with a password the user chose.
 *
 * No default credential ships anywhere — not in the code, not in a
 * migration, not in a config file. This is the only way an ADMIN-level
 * account can come into existence from nothing, and it refuses to run a
 * second time.
 *
 * The "no administrator yet" check is repeated inside the transaction under
 * an advisory lock, because checking before opening one would let two
 * simultaneous requests both pass the check and both create an administrator.
 * Same lock pattern as the payment limit enforcement in
 * repositories/payment/create/createNewPayment.ts.
 */
export async function bootstrapAdministrator(input: BootstrapInput) {
  return transaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('ssv:bootstrap', 0))`);

    const existing = await client.query(
      `
      SELECT 1
      FROM employees e
      JOIN roles r ON r.role_id = e.role_id
      WHERE r.access_level = 'ADMIN'
        AND e.deleted_at IS NULL
      LIMIT 1
      `
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new BootstrapUnavailableError();
    }

    let schoolId: string;

    if (input.new_school) {
      schoolId = input.new_school.school_id.trim();
      await client.query(
        `
        INSERT INTO schools (school_id, school_name, school_type, school_address, school_contact, school_email)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          schoolId,
          input.new_school.school_name,
          input.new_school.school_type,
          input.new_school.school_address,
          input.new_school.school_contact,
          input.new_school.school_email,
        ]
      );
    } else {
      schoolId = (input.school_id ?? "").trim();
      const school = await client.query(`SELECT school_id FROM schools WHERE school_id = $1`, [schoolId]);
      if ((school.rowCount ?? 0) === 0) {
        throw new BootstrapInputError("Choose a school for this administrator.");
      }
    }

    // An existing role of this name (left at CASHIER by migration 006) is
    // promoted rather than duplicated — roles are unique per (school, name),
    // so inserting a second "Administrator" would fail anyway.
    const role = await client.query(
      `
      INSERT INTO roles (school_id, role_name, access_level)
      VALUES ($1, $2, 'ADMIN')
      ON CONFLICT (school_id, role_name) DO UPDATE SET access_level = 'ADMIN'
      RETURNING role_id
      `,
      [schoolId, ADMIN_ROLE_NAME]
    );

    const takenRows = await client.query(`SELECT email FROM employees WHERE school_id = $1`, [schoolId]);
    const taken = new Set<string>(takenRows.rows.map((row) => row.email));
    const email = generateUniqueEmail(input.first_name, input.last_name, schoolId, taken);

    const employee = await client.query(
      `
      INSERT INTO employees (school_id, first_name, last_name, email, password_hash, role_id, must_change_password)
      VALUES ($1, $2, $3, $4, $5, $6, FALSE)
      RETURNING employee_id::int AS employee_id, school_id, first_name, last_name, email
      `,
      [schoolId, input.first_name.trim(), input.last_name.trim(), email, hashPassword(input.password), role.rows[0].role_id]
    );

    const created = employee.rows[0];

    await logAuditWithin(client, {
      employee_id: created.employee_id,
      actor_label: `${created.first_name} ${created.last_name}`.trim(),
      school_id: schoolId,
      action: "auth.bootstrap",
      entity_type: "employee",
      entity_id: String(created.employee_id),
      summary: `Created the first administrator account (${created.email})`,
    });

    return {
      employee_id: created.employee_id,
      school_id: created.school_id.trim(),
      first_name: created.first_name,
      last_name: created.last_name,
      email: created.email,
    };
  });
}

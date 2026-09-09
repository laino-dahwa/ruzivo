import { query, transaction } from "../../lib/db";

// Shared implementation behind the per-entity reference-data update/delete
// repositories (genders, class categories, payment periods, …). Those tables
// are structurally identical — a surrogate id, a school_id, and one or two
// editable columns — so they share one audited implementation here rather than
// seven near-identical SQL strings.

export type ReferenceDependent = {
  /** Table holding rows that point at this reference row. */
  table: string;
  /** Foreign-key column in that table. */
  column: string;
  /** Human wording for the error message, e.g. "learner". */
  noun: string;
};

export type ReferenceTable = {
  table: string;
  idColumn: string;
  /** Columns a caller is allowed to change. Never includes the id. */
  editableColumns: string[];
  /** What must not exist before a row may be deleted. */
  dependents: ReferenceDependent[];
  /** Human wording for messages, e.g. "gender". */
  noun: string;
};

/**
 * Raised when a reference row is still referenced by real records. Deleting is
 * refused rather than cascaded: these rows are pointed at by learners, charges,
 * payments and expenses, and silently removing those would destroy financial
 * history.
 */
export class ReferenceInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceInUseError";
  }
}

// Table and column names come only from the per-entity configs in this
// codebase, never from request data, but they are still validated before being
// interpolated so a future caller cannot turn them into an injection point.
const IDENTIFIER = /^[a-z_]+$/;

function identifier(value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

/**
 * Renames/edits reference rows, matched by their own id and scoped to the
 * school that owns them. A column left undefined or null is kept as-is.
 *
 * The id is never editable, which is what makes this safe: everything that
 * depends on these rows (learners, charges, payments, expenses) references the
 * id, so changing a display name cannot orphan anything.
 */
export async function updateReferenceRows(
  config: ReferenceTable,
  rows: Record<string, unknown>[]
) {
  if (rows.length === 0) {
    return [];
  }

  return transaction(async (client) => {
    const updated = [];

    for (const row of rows) {
      const schoolId = row.school_id;
      const id = row[config.idColumn];

      if (schoolId === undefined || schoolId === null || id === undefined || id === null) {
        throw new Error(`Both school_id and ${config.idColumn} are required to update a ${config.noun}.`);
      }

      // Only columns the caller actually supplied are touched.
      const changes = config.editableColumns.filter(
        (column) => row[column] !== undefined && row[column] !== null
      );

      if (changes.length === 0) {
        continue;
      }

      const assignments = changes.map((column, index) => `${identifier(column)} = $${index + 3}`);
      const values = changes.map((column) => row[column]);

      const result = await client.query(
        `
        UPDATE ${identifier(config.table)}
        SET ${assignments.join(", ")}
        WHERE ${identifier(config.idColumn)} = $1
          AND school_id = $2
        RETURNING *
        `,
        [id, schoolId, ...values]
      );

      if (result.rowCount === 0) {
        throw new Error(`No ${config.noun} with that id belongs to this school.`);
      }

      updated.push(result.rows[0]);
    }

    return updated;
  });
}

/**
 * Deletes one reference row, but only when nothing references it.
 *
 * The database already blocks this for most of these tables (their foreign
 * keys have no ON DELETE action, so Postgres restricts the delete). The
 * exception is expense_categories: expenses.fk_expense_category is
 * ON DELETE CASCADE — needed so deleting a school works — which means the
 * database would happily delete every expense in the category. The check below
 * is what stops that, and it also turns the other tables' raw constraint
 * violations into a message that names what is still using the row.
 */
export async function deleteReferenceRow(
  config: ReferenceTable,
  schoolId: string,
  id: number
) {
  for (const dependent of config.dependents) {
    const result = await query(
      `SELECT count(*)::int AS count FROM ${identifier(dependent.table)} WHERE ${identifier(dependent.column)} = $1`,
      [id]
    );

    const count = Number(result.rows[0]?.count ?? 0);
    if (count > 0) {
      throw new ReferenceInUseError(
        `This ${config.noun} cannot be deleted because ${count} ${dependent.noun}${count === 1 ? "" : "s"} still use${count === 1 ? "s" : ""} it.`
      );
    }
  }

  const result = await query(
    `
    DELETE FROM ${identifier(config.table)}
    WHERE ${identifier(config.idColumn)} = $1
      AND school_id = $2
    RETURNING *
    `,
    [id, schoolId]
  );

  if (result.rowCount === 0) {
    throw new Error(`No ${config.noun} with that id belongs to this school.`);
  }

  return result.rows[0];
}

import { query } from "../../../lib/db";
import { decodeCursor, encodeCursor, type Page } from "../../../lib/pagination";

export type PaymentListFilters = {
    learner_id: string | null;
    class_name: string | null;
    gender_name: string | null;
    academic_year: string | null;
    income_name: string | null;
    payment_period: string | null;
    method_name: string | null;
};

const COLUMNS = `l.learner_id,l.first_name,l.last_name,g.gender_name,ca.class_name,ic.income_name,pp.period_name,ay.academic_year_name,p.amount,pm.method_name,c.charge_id,p.payment_id,p.paid_at`;

// Joins from a payment allocation out to everything the table displays.
const DISPLAY_JOINS = `
        JOIN payments p ON p.payment_id = pa.payment_id
        JOIN charges c ON c.charge_id = pa.charge_id
        JOIN learners l ON l.learner_id = c.learner_id
        JOIN enrolments e ON e.enrolment_id = c.enrolment_id
        JOIN class_categories ca ON ca.class_category_id = e.class_category_id
        JOIN income_categories ic ON ic.income_category_id = c.income_category_id
        JOIN payment_periods pp ON pp.payment_period_id = c.payment_period_id
        JOIN academic_years ay ON ay.academic_year_id = c.academic_year_id
        JOIN genders g ON g.gender_id = l.gender_id
        JOIN payment_methods pm ON pm.payment_method_id = p.payment_method_id`;

const ORDER = `ORDER BY p.paid_at DESC, pa.allocation_id DESC`;

/**
 * Which allocations match, as a FROM + WHERE over only the tables the active
 * filters need — not all ten display tables. That is what lets Postgres walk
 * payments newest-first by idx_payments_paid_at and stop after one page,
 * instead of joining every row first and sorting at the end; and it is what
 * makes the totals query cheap.
 *
 * Only filters that are actually set become conditions — a fixed
 * `($n IS NULL OR col = $n)` list keeps Postgres from using the indexes for
 * the ones that do apply.
 *
 * `gender_id`/`payment_method_id` are nullable, and the display joins are
 * inner joins that drop such rows, so they are excluded here too: the rows
 * counted and the rows shown must always be the same set.
 */
function buildMatch(school_id: string, filters: PaymentListFilters) {
    const params: unknown[] = [school_id];
    const joins: string[] = [];
    const conditions = [
        "l.school_id = $1",
        "l.deleted_at IS NULL",
        "l.gender_id IS NOT NULL",
        "p.payment_method_id IS NOT NULL",
    ];
    const add = (value: string | null, column: string, join?: string) => {
        if (value === null) return;
        if (join) joins.push(join);
        params.push(value);
        conditions.push(`${column} = $${params.length}`);
    };
    add(filters.learner_id, "l.learner_id");
    add(filters.class_name, "ca.class_name",
        "JOIN enrolments e ON e.enrolment_id = c.enrolment_id JOIN class_categories ca ON ca.class_category_id = e.class_category_id");
    add(filters.gender_name, "g.gender_name", "JOIN genders g ON g.gender_id = l.gender_id");
    add(filters.academic_year, "ay.academic_year_name", "JOIN academic_years ay ON ay.academic_year_id = c.academic_year_id");
    add(filters.income_name, "ic.income_name", "JOIN income_categories ic ON ic.income_category_id = c.income_category_id");
    add(filters.payment_period, "pp.period_name", "JOIN payment_periods pp ON pp.payment_period_id = c.payment_period_id");
    add(filters.method_name, "pm.method_name", "JOIN payment_methods pm ON pm.payment_method_id = p.payment_method_id");

    const from = `
        FROM payments p
        JOIN payment_allocations pa ON pa.payment_id = p.payment_id
        JOIN charges c ON c.charge_id = pa.charge_id
        JOIN learners l ON l.learner_id = c.learner_id
        ${joins.join("\n        ")}`;
    return { from, conditions, params };
}

/** Every matching payment, newest first — used by the PDF export. */
export async function getPayments(school_id: string, filters: PaymentListFilters) {
    const { from, conditions, params } = buildMatch(school_id, filters);
    const result = await query(
        `WITH matched AS (SELECT pa.allocation_id ${from} WHERE ${conditions.join(" AND ")})
        SELECT ${COLUMNS}
        FROM matched JOIN payment_allocations pa ON pa.allocation_id = matched.allocation_id
        ${DISPLAY_JOINS}
        ${ORDER}`,
        params
    );
    return result.rows;
}

/**
 * One page of matching payments, newest first, keyed on (paid_at,
 * allocation_id) — see lib/pagination.ts. The page is chosen first over the
 * slim match, and only those rows are joined out for display. The first page
 * also carries the count and sum over every matching row.
 */
export async function getPaymentsPage(
    school_id: string,
    filters: PaymentListFilters,
    limit: number,
    cursor: string | null
): Promise<Page<Record<string, unknown>>> {
    const { from, conditions, params } = buildMatch(school_id, filters);
    const after = decodeCursor(cursor);

    const pageConditions = [...conditions];
    const pageParams = [...params];
    if (after) {
        pageParams.push(after.sortValue, after.id);
        const ts = `$${pageParams.length - 1}::timestamptz`;
        const id = `$${pageParams.length}::bigint`;
        // Spelled out rather than `(p.paid_at, pa.allocation_id) < (ts, id)`:
        // the two columns live in different tables, so the row comparison
        // can't be used as an index condition, while `p.paid_at <= ts` can.
        pageConditions.push(`p.paid_at <= ${ts} AND (p.paid_at < ${ts} OR pa.allocation_id < ${id})`);
    }
    pageParams.push(limit + 1);

    const [pageResult, totalsResult] = await Promise.all([
        query(
            `WITH page AS (
                SELECT pa.allocation_id ${from}
                WHERE ${pageConditions.join(" AND ")}
                ${ORDER}
                LIMIT $${pageParams.length}
            )
            SELECT ${COLUMNS}, pa.allocation_id AS _cursor_id, p.paid_at::text AS _cursor_ts
            FROM page JOIN payment_allocations pa ON pa.allocation_id = page.allocation_id
            ${DISPLAY_JOINS}
            ${ORDER}`,
            pageParams
        ),
        after
            ? null
            : query(
                `SELECT COUNT(*)::int AS total_count, COALESCE(SUM(p.amount), 0)::text AS total_amount
                ${from}
                WHERE ${conditions.join(" AND ")}`,
                params
            ),
    ]);

    // One extra row is fetched only to learn whether another page exists.
    const hasMore = pageResult.rows.length > limit;
    const pageRows = hasMore ? pageResult.rows.slice(0, limit) : pageResult.rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last._cursor_ts, last._cursor_id) : null;
    for (const row of pageRows) {
        delete row._cursor_id;
        delete row._cursor_ts;
    }

    return {
        rows: pageRows,
        next_cursor: nextCursor,
        ...(totalsResult ? totalsResult.rows[0] : {}),
    };
}

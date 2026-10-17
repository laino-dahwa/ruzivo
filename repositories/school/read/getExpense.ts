import { query } from "../../../lib/db";
import { decodeCursor, encodeCursor, type Page } from "../../../lib/pagination";

const COLUMNS = `e.expense_id, e.expense_category_id, e.amount, e.expense_date, e.description, e.created_at`;

/** Every expense for the school, newest first — used by the PDF export. */
export async function getExpense(school_id:string) {
    const result = await query(`
        SELECT ${COLUMNS}
        FROM expenses e
        JOIN expense_categories ec ON ec.expense_category_id = e.expense_category_id
        WHERE ec.school_id = $1
        ORDER BY e.expense_date DESC, e.expense_id DESC`,
        [school_id]
    );

    return result.rows;
}

/**
 * One page of the school's expenses, newest first, keyed on (expense_date,
 * expense_id) — see lib/pagination.ts. The first page also carries the count
 * and sum over all of the school's expenses.
 */
export async function getExpensePage(school_id: string, limit: number, cursor: string | null): Promise<Page<Record<string, unknown>>> {
    const after = decodeCursor(cursor);
    const params: unknown[] = [school_id];
    let afterCondition = "";
    if (after) {
        params.push(after.sortValue, after.id);
        afterCondition = `AND (e.expense_date, e.expense_id) < ($2::date, $3::bigint)`;
    }
    params.push(limit + 1);

    const [pageResult, totalsResult] = await Promise.all([
        query(`
            SELECT ${COLUMNS}, e.expense_date::text AS _cursor_date
            FROM expenses e
            JOIN expense_categories ec ON ec.expense_category_id = e.expense_category_id
            WHERE ec.school_id = $1 ${afterCondition}
            ORDER BY e.expense_date DESC, e.expense_id DESC
            LIMIT $${params.length}`,
            params
        ),
        after
            ? null
            : query(`
                SELECT COUNT(*)::int AS total_count, COALESCE(SUM(e.amount), 0)::text AS total_amount
                FROM expenses e
                JOIN expense_categories ec ON ec.expense_category_id = e.expense_category_id
                WHERE ec.school_id = $1`,
                [school_id]
            ),
    ]);

    // One extra row is fetched only to learn whether another page exists.
    const hasMore = pageResult.rows.length > limit;
    const pageRows = hasMore ? pageResult.rows.slice(0, limit) : pageResult.rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last._cursor_date, last.expense_id) : null;
    for (const row of pageRows) delete row._cursor_date;

    return {
        rows: pageRows,
        next_cursor: nextCursor,
        ...(totalsResult ? totalsResult.rows[0] : {}),
    };
}

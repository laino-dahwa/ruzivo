import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST, DELETE } from "../app/api/schools/[school_id]/expenses/route";
import { createSchool } from "../repositories/school/create/createSchool";
import { createExpenseCategory } from "../repositories/school/create/createExpenseCategory";
import { query } from "../lib/db";

// Dedicated, disposable test schools/categories so this suite never touches
// real data in the shared dev database (practiseDB). Everything created here
// is removed in afterAll.
const SCHOOL_A = "TSA1";
const SCHOOL_B = "TSB1";

let categoryA: number;
let categoryB: number;

function makeParams(school_id: string) {
  return { params: Promise.resolve({ school_id }) };
}

function makeRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

async function readJson(response: Response) {
  return response.json();
}

beforeAll(async () => {
  await createSchool([
    { school_id: SCHOOL_A, school_name: "Test School A", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "a@test.local" },
    { school_id: SCHOOL_B, school_name: "Test School B", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "b@test.local" },
  ]);

  const [catA] = await createExpenseCategory([{ school_id: SCHOOL_A, expense_name: "Test Category A" }]);
  const [catB] = await createExpenseCategory([{ school_id: SCHOOL_B, expense_name: "Test Category B" }]);
  categoryA = catA.expense_category_id;
  categoryB = catB.expense_category_id;
});

afterAll(async () => {
  await query("DELETE FROM expenses WHERE expense_category_id = ANY($1::bigint[])", [[categoryA, categoryB]]);
  await query("DELETE FROM expense_categories WHERE school_id = ANY($1::char(4)[])", [[SCHOOL_A, SCHOOL_B]]);
  await query("DELETE FROM schools WHERE school_id = ANY($1::char(4)[])", [[SCHOOL_A, SCHOOL_B]]);
});

describe("POST /api/schools/[school_id]/expenses (create)", () => {
  it("creates an expense and persists it in Postgres with matching values", async () => {
    const request = makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`, {
      method: "POST",
      body: JSON.stringify([{ expense_category_id: String(categoryA), amount: 100.0, expense_date: "2026-08-01", description: "Test Expense" }]),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const body = await readJson(response);
    expect(body).toHaveLength(1);
    expect(body[0].expense_id).toBeDefined();
    expect(Number(body[0].amount)).toBe(100);
    expect(body[0].description).toBe("Test Expense");

    const dbRow = await query("SELECT expense_category_id, amount, expense_date::text, description FROM expenses WHERE expense_id = $1", [body[0].expense_id]);
    expect(dbRow.rowCount).toBe(1);
    expect(dbRow.rows[0]).toMatchObject({
      expense_category_id: String(categoryA),
      amount: "100.00",
      expense_date: "2026-08-01",
      description: "Test Expense",
    });
  });

  it("accepts a single expense object (backward compatibility) and stores it", async () => {
    const request = makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`, {
      method: "POST",
      body: JSON.stringify({ expense_category_id: String(categoryA), amount: 10, expense_date: "2026-08-01", description: "single object" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const body = await readJson(response);
    expect(body).toHaveLength(1);
    expect(body[0].description).toBe("single object");
  });

  it("creates several expenses from one array in a single request", async () => {
    const request = makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`, {
      method: "POST",
      body: JSON.stringify([
        { expense_category_id: String(categoryA), amount: 11, expense_date: "2026-08-02", description: "bulk one" },
        { expense_category_id: String(categoryA), amount: 12, expense_date: "2026-08-03", description: "bulk two" },
        { expense_category_id: String(categoryA), amount: 13, expense_date: "2026-08-04", description: "bulk three" },
      ]),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const body = await readJson(response);
    expect(body).toHaveLength(3);

    const stored = await query(
      "SELECT description FROM expenses WHERE description = ANY($1::text[]) ORDER BY description",
      [["bulk one", "bulk three", "bulk two"]]
    );
    expect(stored.rowCount).toBe(3);
  });

  it("rejects a body that is neither an object nor an array", async () => {
    const request = makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`, {
      method: "POST",
      body: JSON.stringify("not a record"),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("rejects the whole batch when one record is invalid, and persists none of it", async () => {
    const before = await query("SELECT count(*)::int FROM expenses WHERE expense_category_id = $1", [categoryA]);

    const request = makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`, {
      method: "POST",
      body: JSON.stringify([
        { expense_category_id: String(categoryA), amount: 10, expense_date: "2026-08-01", description: "valid" },
        { expense_category_id: String(categoryA), amount: -5, expense_date: "2026-08-01", description: "invalid amount" },
        { expense_category_id: String(categoryA), amount: 20, expense_date: "2026-08-01", description: "also valid" },
      ]),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await readJson(response);
    // The failing record is identified by its position in the submitted array.
    expect(body.details).toEqual([
      { index: 1, field: "amount", message: "Amount must be greater than zero" },
    ]);
    expect(body.error).toContain("Expense 2");

    const after = await query("SELECT count(*)::int FROM expenses WHERE expense_category_id = $1", [categoryA]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("rejects a zero amount with a field-level error and persists nothing", async () => {
    const before = await query("SELECT count(*)::int FROM expenses WHERE expense_category_id = $1", [categoryA]);

    const request = makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`, {
      method: "POST",
      body: JSON.stringify([{ expense_category_id: String(categoryA), amount: 0, expense_date: "2026-08-01", description: "zero amount" }]),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);

    const after = await query("SELECT count(*)::int FROM expenses WHERE expense_category_id = $1", [categoryA]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("rejects a negative amount with a field-level error and persists nothing", async () => {
    const before = await query("SELECT count(*)::int FROM expenses WHERE expense_category_id = $1", [categoryA]);

    const request = makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`, {
      method: "POST",
      body: JSON.stringify([{ expense_category_id: String(categoryA), amount: -50, expense_date: "2026-08-01", description: "negative amount" }]),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);

    const after = await query("SELECT count(*)::int FROM expenses WHERE expense_category_id = $1", [categoryA]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("rejects a nonexistent expense_category_id (FK violation, surfaced by the DB) and persists nothing", async () => {
    const request = makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`, {
      method: "POST",
      body: JSON.stringify([{ expense_category_id: "999999999", amount: 10, expense_date: "2026-08-01", description: "bad fk" }]),
    });
    const response = await POST(request);
    expect(response.status).toBe(500);
  });

  it("rejects a missing amount field and persists nothing", async () => {
    const request = makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`, {
      method: "POST",
      body: JSON.stringify([{ expense_category_id: String(categoryA), expense_date: "2026-08-01", description: "missing amount" }]),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await readJson(response);
    expect(body.details).toEqual([{ index: 0, field: "amount", message: "Amount is required" }]);
  });
});

describe("GET /api/schools/[school_id]/expenses (retrieve)", () => {
  it("returns an empty array for a school with no expenses", async () => {
    const request = makeRequest(`http://localhost/api/schools/${SCHOOL_B}/expenses`);
    const response = await GET(request, makeParams(SCHOOL_B));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toEqual([]);
  });

  it("returns created expenses for the owning school and matches Postgres exactly", async () => {
    const [created] = await readJson(
      await POST(
        makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`, {
          method: "POST",
          body: JSON.stringify([{ expense_category_id: String(categoryA), amount: 42.5, expense_date: "2026-08-05", description: "GET check" }]),
        })
      )
    );

    const response = await GET(makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`), makeParams(SCHOOL_A));
    const body = await readJson(response);
    const match = body.find((row: { expense_id: number }) => row.expense_id === created.expense_id);
    expect(match).toBeDefined();
    expect(Number(match.amount)).toBe(42.5);
    expect(match.description).toBe("GET check");

    const dbRow = await query("SELECT amount, description FROM expenses WHERE expense_id = $1", [created.expense_id]);
    expect(Number(dbRow.rows[0].amount)).toBe(Number(match.amount));
    expect(dbRow.rows[0].description).toBe(match.description);
  });

  it("does not return another school's expenses (tenant isolation)", async () => {
    const response = await GET(makeRequest(`http://localhost/api/schools/${SCHOOL_B}/expenses`), makeParams(SCHOOL_B));
    const body = await readJson(response);
    expect(body.every((row: { expense_category_id: number }) => row.expense_category_id !== categoryA)).toBe(true);
  });
});

describe("GET /api/schools/[school_id]/expenses?format=pdf (export)", () => {
  it("returns a valid PDF for the expenses table", async () => {
    const response = await GET(makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses?format=pdf`), makeParams(SCHOOL_A));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("expenses-");

    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("produces a valid empty-state PDF for a school with no expenses", async () => {
    const response = await GET(makeRequest(`http://localhost/api/schools/${SCHOOL_B}/expenses?format=pdf`), makeParams(SCHOOL_B));
    expect(response.status).toBe(200);
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});

describe("DELETE /api/schools/[school_id]/expenses (delete)", () => {
  it("deletes an expense, and it no longer appears via GET or in Postgres", async () => {
    const [created] = await readJson(
      await POST(
        makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`, {
          method: "POST",
          body: JSON.stringify([{ expense_category_id: String(categoryA), amount: 15, expense_date: "2026-08-06", description: "to be deleted" }]),
        })
      )
    );

    const deleteResponse = await DELETE(
      makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses?expense_id=${created.expense_id}`, { method: "DELETE" }),
      makeParams(SCHOOL_A)
    );
    expect(deleteResponse.status).toBe(201);
    const deletedBody = await readJson(deleteResponse);
    expect(deletedBody.expense_id).toBe(created.expense_id);

    const getResponse = await GET(makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`), makeParams(SCHOOL_A));
    const rows = await readJson(getResponse);
    expect(rows.some((row: { expense_id: number }) => row.expense_id === created.expense_id)).toBe(false);

    const dbRow = await query("SELECT 1 FROM expenses WHERE expense_id = $1", [created.expense_id]);
    expect(dbRow.rowCount).toBe(0);
  });

  it("rejects deleting a nonexistent expense id", async () => {
    const response = await DELETE(
      makeRequest("http://localhost/api/schools/TSA1/expenses?expense_id=999999999", { method: "DELETE" }),
      makeParams(SCHOOL_A)
    );
    expect(response.status).toBe(500);
  });

  it("rejects a delete request missing expense_id", async () => {
    const response = await DELETE(makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`, { method: "DELETE" }), makeParams(SCHOOL_A));
    expect(response.status).toBe(400);
  });

  it("rejects deleting another school's expense (cross-tenant protection) and leaves it intact", async () => {
    const [created] = await readJson(
      await POST(
        makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses`, {
          method: "POST",
          body: JSON.stringify([{ expense_category_id: String(categoryA), amount: 20, expense_date: "2026-08-07", description: "cross tenant guard" }]),
        })
      )
    );

    const crossDeleteResponse = await DELETE(
      makeRequest(`http://localhost/api/schools/${SCHOOL_B}/expenses?expense_id=${created.expense_id}`, { method: "DELETE" }),
      makeParams(SCHOOL_B)
    );
    expect(crossDeleteResponse.status).toBe(500);

    const dbRow = await query("SELECT 1 FROM expenses WHERE expense_id = $1", [created.expense_id]);
    expect(dbRow.rowCount).toBe(1);

    // cleanup this one directly since it belongs to SCHOOL_A
    await DELETE(
      makeRequest(`http://localhost/api/schools/${SCHOOL_A}/expenses?expense_id=${created.expense_id}`, { method: "DELETE" }),
      makeParams(SCHOOL_A)
    );
  });
});

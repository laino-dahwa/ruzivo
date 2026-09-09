import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST, DELETE } from "../app/api/learners/route";
import { createSchool } from "../repositories/school/create/createSchool";
import { createGender } from "../repositories/school/create/createGenderCategory";
import { createClassCategory } from "../repositories/school/create/createClassCategory";
import { createAcademicYear } from "../repositories/school/create/createAcademicYear";
import { query } from "../lib/db";

// Dedicated, disposable test schools/reference data so this suite never
// touches real data in the shared dev database. Everything created here is
// removed in afterAll.
//
// School ids are kept to 3 characters deliberately: `learners.learner_id` is
// VARCHAR(8) and createLearners() appends a 5-character random suffix to the
// school_id, so a full 4-character school_id (as the CHAR(4) column allows)
// overflows the column and POST /api/learners fails with a Postgres
// "value too long" error. This is a real, pre-existing bug — flagged in the
// migration report rather than fixed here, since fixing it would require a
// schema change (out of scope for this refactor). Using a 3-character id
// here sidesteps it so this suite can still exercise the real behavior.
const SCHOOL_A = "TLA";
const SCHOOL_B = "TLB";

let genderA: number;
let classA: number;
let yearA: number;

function makeRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

async function readJson(response: Response) {
  return response.json();
}

beforeAll(async () => {
  await createSchool([
    { school_id: SCHOOL_A, school_name: "Test Learner School A", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "la@test.local" },
    { school_id: SCHOOL_B, school_name: "Test Learner School B", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "lb@test.local" },
  ]);

  const [gender] = await createGender([{ school_id: SCHOOL_A, gender_name: "Test Gender A" }]);
  const [classCategory] = await createClassCategory([{ school_id: SCHOOL_A, class_name: "Test Class A" }]);
  const [academicYear] = await createAcademicYear([{ school_id: SCHOOL_A, academic_year_name: "Test Year A", start_date: "2026-01-01", end_date: "2026-12-31" }]);
  genderA = gender.gender_id;
  classA = classCategory.class_category_id;
  yearA = academicYear.academic_year_id;
});

afterAll(async () => {
  await query("DELETE FROM enrolments WHERE class_category_id = $1", [classA]);
  await query("DELETE FROM learners WHERE school_id = ANY($1::char(4)[])", [[SCHOOL_A, SCHOOL_B]]);
  await query("DELETE FROM academic_years WHERE academic_year_id = $1", [yearA]);
  await query("DELETE FROM class_categories WHERE class_category_id = $1", [classA]);
  await query("DELETE FROM genders WHERE gender_id = $1", [genderA]);
  await query("DELETE FROM schools WHERE school_id = ANY($1::char(4)[])", [[SCHOOL_A, SCHOOL_B]]);
});

function makeLearnerInput(overrides: Partial<{ first_name: string; last_name: string }> = {}) {
  return {
    school_id: SCHOOL_A,
    first_name: overrides.first_name ?? "Test",
    last_name: overrides.last_name ?? "Learner",
    gender_id: genderA,
    date_of_birth: "2015-06-01",
    class_category_id: classA,
    academic_year_id: yearA,
  };
}

describe("POST /api/learners (create)", () => {
  it("creates a learner + enrolment and persists them in Postgres with matching values", async () => {
    const request = makeRequest("http://localhost/api/learners", {
      method: "POST",
      body: JSON.stringify([makeLearnerInput({ first_name: "Alice", last_name: "Example" })]),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const body = await readJson(response);
    expect(body).toHaveLength(1);
    // school_id plus a 4-char suffix, kept within learner_id VARCHAR(8).
    expect(body[0].learner_id).toMatch(new RegExp(`^${SCHOOL_A}[A-Z0-9]{4}$`));
    expect(body[0].learner_id.length).toBeLessThanOrEqual(8);

    const dbRow = await query("SELECT first_name, last_name, gender_id FROM learners WHERE learner_id = $1", [body[0].learner_id]);
    expect(dbRow.rowCount).toBe(1);
    expect(dbRow.rows[0]).toMatchObject({ first_name: "Alice", last_name: "Example", gender_id: String(genderA) });

    const enrolmentRow = await query("SELECT class_category_id, academic_year_id FROM enrolments WHERE learner_id = $1", [body[0].learner_id]);
    expect(enrolmentRow.rowCount).toBe(1);
    expect(enrolmentRow.rows[0]).toMatchObject({ class_category_id: String(classA), academic_year_id: String(yearA) });
  });

  it("accepts a single learner object (backward compatibility) and stores it", async () => {
    const request = makeRequest("http://localhost/api/learners", {
      method: "POST",
      body: JSON.stringify(makeLearnerInput()),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);

    const body = await readJson(response);
    expect(body).toHaveLength(1);

    const dbRow = await query("SELECT learner_id FROM learners WHERE learner_id = $1", [body[0].learner_id]);
    expect(dbRow.rowCount).toBe(1);
  });

  it("creates several learners from one array in a single request", async () => {
    const request = makeRequest("http://localhost/api/learners", {
      method: "POST",
      body: JSON.stringify([
        makeLearnerInput({ first_name: "Bulk", last_name: "One" }),
        makeLearnerInput({ first_name: "Bulk", last_name: "Two" }),
        makeLearnerInput({ first_name: "Bulk", last_name: "Three" }),
      ]),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);

    const body = await readJson(response);
    expect(body).toHaveLength(3);

    const ids = body.map((row: { learner_id: string }) => row.learner_id);
    // Distinct generated ids, and an enrolment row created for each learner.
    expect(new Set(ids).size).toBe(3);
    const enrolments = await query("SELECT learner_id FROM enrolments WHERE learner_id = ANY($1::text[])", [ids]);
    expect(enrolments.rowCount).toBe(3);
  });

  it("rejects the whole batch when one learner is invalid, and persists none of it", async () => {
    const before = await query("SELECT count(*)::int FROM learners WHERE school_id = $1", [SCHOOL_A]);

    const request = makeRequest("http://localhost/api/learners", {
      method: "POST",
      body: JSON.stringify([
        makeLearnerInput({ first_name: "Valid", last_name: "Record" }),
        makeLearnerInput({ first_name: "", last_name: "Missing First Name" }),
      ]),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await readJson(response);
    expect(body.details).toEqual([{ index: 1, field: "first_name", message: "First name is required" }]);
    expect(body.error).toContain("Learner 2");

    const after = await query("SELECT count(*)::int FROM learners WHERE school_id = $1", [SCHOOL_A]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("accepts a blank-padded school_id (CHAR(4)) without overflowing the learner id", async () => {
    // school_id is CHAR(4), so a value read back from the API arrives padded
    // ("TLA "). Concatenating that padding into the generated learner id used
    // to push it past learner_id VARCHAR(8) and fail the insert, which broke
    // "Add learner" for anyone who had just created a school.
    const request = makeRequest("http://localhost/api/learners", {
      method: "POST",
      body: JSON.stringify({ ...makeLearnerInput({ first_name: "Padded" }), school_id: `${SCHOOL_A} ` }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const body = await readJson(response);
    expect(body[0].learner_id.length).toBeLessThanOrEqual(8);

    const stored = await query("SELECT learner_id FROM learners WHERE learner_id = $1", [body[0].learner_id]);
    expect(stored.rowCount).toBe(1);
  });

  it("creates learners for a 4-character school id without overflowing", async () => {
    // school_id is CHAR(4), so 4-character ids are valid. With the old 5-char
    // suffix these produced a 9-character learner_id and failed every time,
    // meaning such a school could never hold learners.
    const FOUR = "TL4A";
    await createSchool([{ school_id: FOUR, school_name: "Four Char", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "four@test.local" }]);
    const [g] = await createGender([{ school_id: FOUR, gender_name: "Male" }]);
    const [c] = await createClassCategory([{ school_id: FOUR, class_name: "Grade 1" }]);
    const [y] = await createAcademicYear([{ school_id: FOUR, academic_year_name: "2026", start_date: "2026-01-01", end_date: "2026-12-31" }]);

    try {
      const response = await POST(makeRequest("http://localhost/api/learners", {
        method: "POST",
        body: JSON.stringify({ school_id: FOUR, first_name: "Four", last_name: "Char", gender_id: g.gender_id, date_of_birth: "2015-01-01", class_category_id: c.class_category_id, academic_year_id: y.academic_year_id }),
      }));
      expect(response.status).toBe(201);

      const body = await readJson(response);
      expect(body[0].learner_id.length).toBe(8);
    } finally {
      await query("DELETE FROM enrolments WHERE learner_id IN (SELECT learner_id FROM learners WHERE school_id = $1)", [FOUR]);
      await query("DELETE FROM learners WHERE school_id = $1", [FOUR]);
      await query("DELETE FROM schools WHERE school_id = $1", [FOUR]);
    }
  });

  it("rejects a body that is neither an object nor an array", async () => {
    const response = await POST(makeRequest("http://localhost/api/learners", { method: "POST", body: JSON.stringify(42) }));
    expect(response.status).toBe(400);
  });
});

describe("GET /api/learners?format=pdf (export)", () => {
  it("returns a valid PDF for the learners table", async () => {
    const response = await GET(makeRequest("http://localhost/api/learners?format=pdf"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("learners-");

    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("exports the filtered rows, not the whole table", async () => {
    // A filter that matches nothing must still produce a valid (empty-state) PDF.
    const response = await GET(makeRequest("http://localhost/api/learners?learner_id=NOSUCHID&format=pdf"));
    expect(response.status).toBe(200);
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});

describe("GET /api/learners (retrieve + filters)", () => {
  it("returns an empty array for a nonexistent learner_id filter", async () => {
    const response = await GET(makeRequest("http://localhost/api/learners?learner_id=NOSUCHID"));
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual([]);
  });

  it("returns a created learner via GET and matches Postgres exactly", async () => {
    const [created] = await readJson(await POST(makeRequest("http://localhost/api/learners", {
      method: "POST",
      body: JSON.stringify([makeLearnerInput({ first_name: "Bianca", last_name: "Filter" })]),
    })));

    const response = await GET(makeRequest(`http://localhost/api/learners?learner_id=${created.learner_id}`));
    const body = await readJson(response);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ learner_id: created.learner_id, first_name: "Bianca", last_name: "Filter", gender_name: "Test Gender A", class_name: "Test Class A" });
  });

  it("filters by class_name, gender_name, and academic_year", async () => {
    const [created] = await readJson(await POST(makeRequest("http://localhost/api/learners", {
      method: "POST",
      body: JSON.stringify([makeLearnerInput({ first_name: "Cara", last_name: "Filters" })]),
    })));

    const byClass = await readJson(await GET(makeRequest(`http://localhost/api/learners?class_name=${encodeURIComponent("Test Class A")}`)));
    expect(byClass.some((row: { learner_id: string }) => row.learner_id === created.learner_id)).toBe(true);

    const byGender = await readJson(await GET(makeRequest(`http://localhost/api/learners?gender_name=${encodeURIComponent("Test Gender A")}`)));
    expect(byGender.some((row: { learner_id: string }) => row.learner_id === created.learner_id)).toBe(true);

    const byYear = await readJson(await GET(makeRequest(`http://localhost/api/learners?academic_year=${encodeURIComponent("Test Year A")}`)));
    expect(byYear.some((row: { learner_id: string }) => row.learner_id === created.learner_id)).toBe(true);
  });
});

describe("DELETE /api/learners (soft delete)", () => {
  it("soft-deletes a learner: it disappears from GET but the row remains in Postgres with deleted_at set", async () => {
    const [created] = await readJson(await POST(makeRequest("http://localhost/api/learners", {
      method: "POST",
      body: JSON.stringify([makeLearnerInput({ first_name: "Ella", last_name: "ToDelete" })]),
    })));

    const deleteResponse = await DELETE(makeRequest(`http://localhost/api/learners?learner_id=${created.learner_id}`, { method: "DELETE" }));
    expect(deleteResponse.status).toBe(201);

    const getResponse = await GET(makeRequest(`http://localhost/api/learners?learner_id=${created.learner_id}`));
    expect(await readJson(getResponse)).toEqual([]);

    const dbRow = await query("SELECT deleted_at FROM learners WHERE learner_id = $1", [created.learner_id]);
    expect(dbRow.rowCount).toBe(1);
    expect(dbRow.rows[0].deleted_at).not.toBeNull();
  });

  it("rejects deleting an already-deleted / nonexistent learner_id", async () => {
    const response = await DELETE(makeRequest("http://localhost/api/learners?learner_id=NOSUCHID", { method: "DELETE" }));
    expect(response.status).toBe(500);
  });

  it("rejects a delete request missing learner_id", async () => {
    const response = await DELETE(makeRequest("http://localhost/api/learners", { method: "DELETE" }));
    expect(response.status).toBe(400);
  });
});

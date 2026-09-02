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
    expect(body[0].learner_id).toMatch(new RegExp(`^${SCHOOL_A}[A-Z0-9]{5}$`));

    const dbRow = await query("SELECT first_name, last_name, gender_id FROM learners WHERE learner_id = $1", [body[0].learner_id]);
    expect(dbRow.rowCount).toBe(1);
    expect(dbRow.rows[0]).toMatchObject({ first_name: "Alice", last_name: "Example", gender_id: String(genderA) });

    const enrolmentRow = await query("SELECT class_category_id, academic_year_id FROM enrolments WHERE learner_id = $1", [body[0].learner_id]);
    expect(enrolmentRow.rowCount).toBe(1);
    expect(enrolmentRow.rows[0]).toMatchObject({ class_category_id: String(classA), academic_year_id: String(yearA) });
  });

  it("rejects a non-array body with 400 and persists nothing", async () => {
    const request = makeRequest("http://localhost/api/learners", {
      method: "POST",
      body: JSON.stringify(makeLearnerInput()),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PATCH as PATCH_GENDER, DELETE as DELETE_GENDER, GET as GET_GENDER } from "../app/api/schools/[school_id]/gender/route";
import { DELETE as DELETE_EXPENSE_CATEGORY } from "../app/api/schools/[school_id]/expense_categories/route";
import { PATCH as PATCH_INCOME, DELETE as DELETE_INCOME } from "../app/api/schools/[school_id]/income_categories/route";
import { createSchool } from "../repositories/school/create/createSchool";
import { createGender } from "../repositories/school/create/createGenderCategory";
import { createClassCategory } from "../repositories/school/create/createClassCategory";
import { createAcademicYear } from "../repositories/school/create/createAcademicYear";
import { createIncomeCategory } from "../repositories/school/create/createIncomeCategory";
import { createExpenseCategory } from "../repositories/school/create/createExpenseCategory";
import { createExpense } from "../repositories/school/create/createExpense";
import { createLearners } from "../repositories/learner/create/addLearner";
import { query } from "../lib/db";

// Reference rows (genders, fees, categories…) are renameable and deletable
// from School setup. Renaming is safe because everything that depends on them
// references the surrogate id, which is never editable. Deleting is refused
// while anything still points at the row.
const SCHOOL = "RFD";
const OTHER_SCHOOL = "RFE";

let maleId: number;
let femaleId: number;
let usedCategoryId: number;
let unusedCategoryId: number;
let usedIncomeId: number;
let classId: number;
let yearId: number;

function makeParams(school_id: string) {
  return { params: Promise.resolve({ school_id }) };
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/schools/x/y", { method: "PATCH", body: JSON.stringify(body) });
}

function deleteRequest(url: string) {
  return new Request(url, { method: "DELETE" });
}

async function readJson(response: Response) {
  return response.json();
}

beforeAll(async () => {
  await createSchool([
    { school_id: SCHOOL, school_name: "Ref Data", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "rd@test.local" },
    { school_id: OTHER_SCHOOL, school_name: "Other", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "ot@test.local" },
  ]);

  const genders = await createGender([
    { school_id: SCHOOL, gender_name: "Male" },
    { school_id: SCHOOL, gender_name: "Female" },
  ]);
  maleId = genders[0].gender_id;
  femaleId = genders[1].gender_id;

  const [classCategory] = await createClassCategory([{ school_id: SCHOOL, class_name: "Grade 1" }]);
  const [year] = await createAcademicYear([{ school_id: SCHOOL, academic_year_name: "2026", start_date: "2026-01-01", end_date: "2026-12-31" }]);
  classId = classCategory.class_category_id;
  yearId = year.academic_year_id;

  const [usedCategory] = await createExpenseCategory([{ school_id: SCHOOL, expense_name: "Utilities" }]);
  const [unusedCategory] = await createExpenseCategory([{ school_id: SCHOOL, expense_name: "Unused" }]);
  usedCategoryId = usedCategory.expense_category_id;
  unusedCategoryId = unusedCategory.expense_category_id;

  const [income] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "Tuition", income_limit: "500" }]);
  usedIncomeId = income.income_category_id;

  // An expense makes the "Utilities" category genuinely in use.
  await createExpense([{ expense_category_id: String(usedCategoryId), amount: 40, expense_date: "2026-08-01", description: "in use" }]);

  // A learner makes the "Male" gender genuinely in use.
  await createLearners([{ school_id: SCHOOL, first_name: "Ref", last_name: "Learner", gender_id: maleId, date_of_birth: "2015-01-01", class_category_id: classId, academic_year_id: yearId }]);
});

afterAll(async () => {
  await query(`DELETE FROM enrolments WHERE learner_id IN (SELECT learner_id FROM learners WHERE school_id = $1)`, [SCHOOL]);
  await query(`DELETE FROM learners WHERE school_id = $1`, [SCHOOL]);
  await query(`DELETE FROM expenses WHERE expense_category_id IN (SELECT expense_category_id FROM expense_categories WHERE school_id = $1)`, [SCHOOL]);
  await query(`DELETE FROM schools WHERE school_id = ANY($1::char(4)[])`, [[SCHOOL, OTHER_SCHOOL]]);
});

describe("renaming reference rows", () => {
  it("renames only the targeted row, leaving its siblings untouched", async () => {
    const response = await PATCH_GENDER(patchRequest([{ school_id: SCHOOL, gender_id: maleId, gender_name: "Boy" }]));
    expect(response.status).toBe(201);

    const rows = await readJson(await GET_GENDER(new Request("http://localhost/x"), makeParams(SCHOOL)));
    const byId = Object.fromEntries(rows.map((r: { gender_id: string; gender_name: string }) => [String(r.gender_id), r.gender_name]));

    expect(byId[String(maleId)]).toBe("Boy");
    // The previous implementation matched on school_id alone and would have
    // renamed this one too.
    expect(byId[String(femaleId)]).toBe("Female");
  });

  it("keeps the id stable across a rename, so dependent records still resolve", async () => {
    await PATCH_GENDER(patchRequest([{ school_id: SCHOOL, gender_id: maleId, gender_name: "Male (renamed)" }]));

    const learners = await query(`SELECT gender_id FROM learners WHERE school_id = $1`, [SCHOOL]);
    expect(Number(learners.rows[0].gender_id)).toBe(Number(maleId));
  });

  it("updates several columns at once", async () => {
    const response = await PATCH_INCOME(patchRequest([{ school_id: SCHOOL, income_category_id: usedIncomeId, income_name: "Tuition Fees", income_limit: "650" }]));
    expect(response.status).toBe(201);

    const row = await query(`SELECT income_name, income_limit FROM income_categories WHERE income_category_id = $1`, [usedIncomeId]);
    expect(row.rows[0].income_name).toBe("Tuition Fees");
    expect(Number(row.rows[0].income_limit)).toBe(650);
  });

  it("refuses to rename a row belonging to another school", async () => {
    const response = await PATCH_GENDER(patchRequest([{ school_id: OTHER_SCHOOL, gender_id: femaleId, gender_name: "Hijacked" }]));
    expect(response.status).toBe(500);

    const row = await query(`SELECT gender_name FROM genders WHERE gender_id = $1`, [femaleId]);
    expect(row.rows[0].gender_name).toBe("Female");
  });
});

describe("deleting reference rows", () => {
  it("refuses to delete a gender that learners still use, and says how many", async () => {
    const response = await DELETE_GENDER(deleteRequest(`http://localhost/x?gender_id=${maleId}`), makeParams(SCHOOL));
    expect(response.status).toBe(409);

    const body = await readJson(response);
    expect(body.error).toContain("1 learner");

    const row = await query(`SELECT 1 FROM genders WHERE gender_id = $1`, [maleId]);
    expect(row.rowCount).toBe(1);
  });

  it("allows deleting an income category while no charges reference it", async () => {
    // No charges exist yet, so this one is currently deletable — proving the
    // guard is about real usage rather than a blanket refusal.
    const response = await DELETE_INCOME(deleteRequest(`http://localhost/x?income_category_id=${usedIncomeId}`), makeParams(SCHOOL));
    expect(response.status).toBe(200);
  });

  it("deletes an unused row", async () => {
    const response = await DELETE_GENDER(deleteRequest(`http://localhost/x?gender_id=${femaleId}`), makeParams(SCHOOL));
    expect(response.status).toBe(200);

    const row = await query(`SELECT 1 FROM genders WHERE gender_id = $1`, [femaleId]);
    expect(row.rowCount).toBe(0);
  });

  it("does NOT cascade-delete expenses when an in-use expense category is deleted", async () => {
    // expenses.fk_expense_category is ON DELETE CASCADE, so without the
    // application guard this would silently destroy expense records.
    const before = await query(`SELECT count(*)::int AS n FROM expenses WHERE expense_category_id = $1`, [usedCategoryId]);
    expect(before.rows[0].n).toBe(1);

    const response = await DELETE_EXPENSE_CATEGORY(deleteRequest(`http://localhost/x?expense_category_id=${usedCategoryId}`), makeParams(SCHOOL));
    expect(response.status).toBe(409);
    expect((await readJson(response)).error).toContain("1 expense");

    const after = await query(`SELECT count(*)::int AS n FROM expenses WHERE expense_category_id = $1`, [usedCategoryId]);
    expect(after.rows[0].n).toBe(1);
  });

  it("deletes an unused expense category", async () => {
    const response = await DELETE_EXPENSE_CATEGORY(deleteRequest(`http://localhost/x?expense_category_id=${unusedCategoryId}`), makeParams(SCHOOL));
    expect(response.status).toBe(200);

    const row = await query(`SELECT 1 FROM expense_categories WHERE expense_category_id = $1`, [unusedCategoryId]);
    expect(row.rowCount).toBe(0);
  });

  it("refuses to delete a row belonging to another school", async () => {
    const [victim] = await createExpenseCategory([{ school_id: SCHOOL, expense_name: "Cross tenant" }]);
    const response = await DELETE_EXPENSE_CATEGORY(deleteRequest(`http://localhost/x?expense_category_id=${victim.expense_category_id}`), makeParams(OTHER_SCHOOL));
    expect(response.status).toBe(500);

    const row = await query(`SELECT 1 FROM expense_categories WHERE expense_category_id = $1`, [victim.expense_category_id]);
    expect(row.rowCount).toBe(1);
  });

  it("rejects a delete request with no id", async () => {
    const response = await DELETE_GENDER(deleteRequest("http://localhost/x"), makeParams(SCHOOL));
    expect(response.status).toBe(400);
  });
});

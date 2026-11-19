import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { query } from "../lib/db";
import { createSchool } from "../repositories/school/create/createSchool";
import { createGender } from "../repositories/school/create/createGenderCategory";
import { createClassCategory } from "../repositories/school/create/createClassCategory";
import { createAcademicYear } from "../repositories/school/create/createAcademicYear";
import { signInForTests, withSession } from "./helpers/session";

/**
 * Every API route checks who is asking (lib/auth/guard.ts). The sign-in
 * endpoints are the only ones open without a session, and each of them
 * checks the session itself where it needs one.
 */
const PUBLIC_ROUTES = new Set([
  "auth/bootstrap",
  "auth/login",
  "auth/logout",
  "auth/recover",
  "auth/session",
]);

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

function routeFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full, base);
    return name === "route.ts" ? [path.relative(base, path.dirname(full)).split(path.sep).join("/")] : [];
  });
}

describe("every API route refuses a caller who is not signed in", () => {
  const apiDir = path.join(__dirname, "..", "app", "api");
  const routes = routeFiles(apiDir).filter((route) => !PUBLIC_ROUTES.has(route));

  it("finds the routes", () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  for (const route of routes) {
    it(route, async () => {
      const handlers = (await import(`../app/api/${route}/route`)) as Partial<Record<(typeof METHODS)[number], Handler>>;
      const methods = METHODS.filter((method) => typeof handlers[method] === "function");
      expect(methods.length, `${route} exports no handlers`).toBeGreaterThan(0);
      for (const method of methods) {
        const response = await handlers[method]!(
          new Request("http://localhost/api/x?school_id=ZZZ&learner_id=x&charge_id=1&employee_id=1", {
            method,
            headers: { "content-type": "application/json" },
            body: method === "GET" ? undefined : "{}",
          }),
          { params: Promise.resolve({ school_id: "ZZZ", employee_id: "1", document_id: "1", run_id: "1" }) },
        );
        expect(response.status, `${method} ${route}`).toBe(401);
      }
    });
  }
});

describe("a cashier stays inside their own school", () => {
  // Three letters on purpose: CHAR(4) pads it to "TCA " in the session, which
  // must still match "TCA" in the URL.
  const OWN = "TCA";
  const OTHER = "TCB";
  let cashier = "";
  let otherClassId = 0;
  let otherYearId = 0;
  let otherGenderId = 0;

  beforeAll(async () => {
    await createSchool([
      { school_id: OWN, school_name: "Cashier Own", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "tca@test.local" },
      { school_id: OTHER, school_name: "Cashier Other", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "tcb@test.local" },
    ]);
    cashier = await signInForTests(OWN, "CASHIER");
    otherGenderId = Number((await createGender([{ school_id: OTHER, gender_name: "Female" }]))[0].gender_id);
    otherClassId = Number((await createClassCategory([{ school_id: OTHER, class_name: "Other class" }]))[0].class_category_id);
    otherYearId = Number((await createAcademicYear([{ school_id: OTHER, academic_year_name: "2026", start_date: "2026-01-01", end_date: "2026-12-31" }]))[0].academic_year_id);
  });

  afterAll(async () => {
    await query(`DELETE FROM enrolments WHERE learner_id IN (SELECT learner_id FROM learners WHERE school_id = ANY($1::char(4)[]))`, [[OWN, OTHER]]);
    await query(`DELETE FROM learners WHERE school_id = ANY($1::char(4)[])`, [[OWN, OTHER]]);
    await query(`DELETE FROM schools WHERE school_id = ANY($1::char(4)[])`, [[OWN, OTHER]]);
  });

  const as = (url: string, init?: RequestInit) => new Request(url, withSession({ headers: { "content-type": "application/json" }, ...init }, cashier));
  const params = (school_id: string) => ({ params: Promise.resolve({ school_id }) });

  it("reads its own school's reference data and expected fees", async () => {
    const { GET: GET_GENDER } = await import("../app/api/schools/[school_id]/gender/route");
    const { GET: GET_FEES } = await import("../app/api/schools/[school_id]/expected-fees/route");
    expect((await GET_GENDER(as("http://localhost/x"), params(OWN))).status).toBe(200);
    expect((await GET_FEES(as("http://localhost/x"), params(OWN))).status).toBe(200);
  });

  it("cannot read another school's data", async () => {
    const { GET: GET_GENDER } = await import("../app/api/schools/[school_id]/gender/route");
    const { GET: GET_BALANCES } = await import("../app/api/learners/balances/route");
    const { GET: GET_LEARNERS } = await import("../app/api/learners/route");
    expect((await GET_GENDER(as("http://localhost/x"), params(OTHER))).status).toBe(403);
    expect((await GET_BALANCES(as(`http://localhost/x?school_id=${OTHER}`))).status).toBe(403);
    expect((await GET_LEARNERS(as(`http://localhost/x?school_id=${OTHER}`))).status).toBe(403);
  });

  it("cannot add a learner to another school", async () => {
    const { POST } = await import("../app/api/learners/route");
    const response = await POST(as("http://localhost/api/learners", {
      method: "POST",
      body: JSON.stringify([{
        school_id: OTHER, first_name: "Not", last_name: "Mine", gender_id: otherGenderId, date_of_birth: "2015-01-01",
        class_category_id: otherClassId, academic_year_id: otherYearId,
      }]),
    }));
    expect(response.status).toBe(403);
    expect((await query(`SELECT 1 FROM learners WHERE school_id = $1`, [OTHER])).rows).toHaveLength(0);
  });

  it("sees only its own school's learners", async () => {
    const { createLearners } = await import("../repositories/learner/create/addLearner");
    const [theirs] = await createLearners([{
      school_id: OTHER, first_name: "Their", last_name: "Learner", gender_id: otherGenderId, date_of_birth: "2015-01-01",
      class_category_id: otherClassId, academic_year_id: otherYearId,
    }]);
    const { GET } = await import("../app/api/learners/route");
    const rows = (await (await GET(as("http://localhost/api/learners"))).json()) as { learner_id: string }[];
    expect(rows.some((row) => row.learner_id === theirs.learner_id)).toBe(false);
  });

  it("cannot do administrator work", async () => {
    const { POST: POST_PERIOD } = await import("../app/api/schools/[school_id]/payment_periods/route");
    const { GET: GET_REPORT } = await import("../app/api/schools/[school_id]/reports/summary/route");
    const { DELETE: DELETE_PAYMENT } = await import("../app/api/learners/payments/route");
    expect((await POST_PERIOD(as("http://localhost/x", { method: "POST", body: JSON.stringify([{ school_id: OWN, period_name: "Sneaky" }]) }))).status).toBe(403);
    expect((await GET_REPORT(as("http://localhost/x"), params(OWN))).status).toBe(403);
    expect((await DELETE_PAYMENT(as("http://localhost/x?charge_id=1", { method: "DELETE" }))).status).toBe(403);
  });
});

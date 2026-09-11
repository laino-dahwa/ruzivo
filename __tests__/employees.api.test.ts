import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST, DELETE } from "../app/api/schools/[school_id]/employees/route";
import { createSchool } from "../repositories/school/create/createSchool";
import { createRole } from "../repositories/school/create/createRole";
import { query } from "../lib/db";

// Dedicated, disposable test school so this suite never touches real data in
// the shared dev database. Removed in afterAll.
const SCHOOL_A = "TEA";

let teacherRoleId: number;
let bursarRoleId: number;

function makeRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

function makeParams(school_id: string) {
  return { params: Promise.resolve({ school_id }) };
}

async function readJson(response: Response) {
  return response.json();
}

beforeAll(async () => {
  await createSchool([
    { school_id: SCHOOL_A, school_name: "Test Employee School A", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "ea@test.local" },
  ]);
  const [teacher] = await createRole([{ school_id: SCHOOL_A, role_name: "Teacher" }]);
  const [bursar] = await createRole([{ school_id: SCHOOL_A, role_name: "Bursar" }]);
  teacherRoleId = teacher.role_id;
  bursarRoleId = bursar.role_id;
});

afterAll(async () => {
  await query("DELETE FROM employees WHERE school_id = $1", [SCHOOL_A]);
  await query("DELETE FROM roles WHERE school_id = $1", [SCHOOL_A]);
  await query("DELETE FROM schools WHERE school_id = $1", [SCHOOL_A]);
});

function makeEmployeeInput(overrides: Partial<{ first_name: string; last_name: string; role_id: number }> = {}) {
  return {
    school_id: SCHOOL_A,
    first_name: overrides.first_name ?? "Test",
    last_name: overrides.last_name ?? "Employee",
    role_id: overrides.role_id ?? teacherRoleId,
  };
}

describe("POST /api/schools/:school_id/employees (create)", () => {
  it("generates the email, a temporary password, and a hash — never accepting any of them from the caller", async () => {
    const response = await POST(makeRequest("http://localhost/api/schools/TEA/employees", {
      method: "POST",
      body: JSON.stringify([makeEmployeeInput({ first_name: "John", last_name: "Doe", role_id: bursarRoleId })]),
    }));
    expect(response.status).toBe(201);

    const [created] = await readJson(response);
    expect(created.email).toBe(`jdoe@${SCHOOL_A.toLowerCase()}.school`);
    expect(created.role_name).toBe("Bursar");
    expect(created.must_change_password).toBe(true);
    expect(typeof created.temporary_password).toBe("string");
    expect(created.temporary_password.length).toBeGreaterThanOrEqual(10);
    // The hash never leaves the repository via this response.
    expect(created.password_hash).toBeUndefined();

    const dbRow = await query("SELECT email, password_hash, must_change_password FROM employees WHERE employee_id = $1", [created.employee_id]);
    expect(dbRow.rows[0].email).toBe(created.email);
    expect(dbRow.rows[0].must_change_password).toBe(true);
    // Stored as a salted hash, not the plaintext temporary password.
    expect(dbRow.rows[0].password_hash).not.toBe(created.temporary_password);
    expect(dbRow.rows[0].password_hash).toMatch(/^scrypt\$/);
  });

  it("dedupes emails that would otherwise collide, within one batch and against existing rows", async () => {
    const response = await POST(makeRequest("http://localhost/api/schools/TEA/employees", {
      method: "POST",
      body: JSON.stringify([
        makeEmployeeInput({ first_name: "Jane", last_name: "Smith" }),
        makeEmployeeInput({ first_name: "Jack", last_name: "Smith" }),
      ]),
    }));
    expect(response.status).toBe(201);

    const created = await readJson(response);
    const emails = created.map((employee: { email: string }) => employee.email);
    expect(new Set(emails).size).toBe(2);
    expect(emails).toContain(`jsmith@${SCHOOL_A.toLowerCase()}.school`);
    expect(emails).toContain(`jsmith1@${SCHOOL_A.toLowerCase()}.school`);
  });

  it("rejects a record missing a required field", async () => {
    const response = await POST(makeRequest("http://localhost/api/schools/TEA/employees", {
      method: "POST",
      body: JSON.stringify([{ school_id: SCHOOL_A, first_name: "", last_name: "NoFirstName", role_id: teacherRoleId }]),
    }));
    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect(body.error).toContain("First name is required");
  });

  it("rejects a role_id that does not exist", async () => {
    const response = await POST(makeRequest("http://localhost/api/schools/TEA/employees", {
      method: "POST",
      body: JSON.stringify([makeEmployeeInput({ first_name: "Bad", last_name: "Role", role_id: 999999999 })]),
    }));
    expect(response.status).toBe(500);
  });
});

describe("GET /api/schools/:school_id/employees (list)", () => {
  it("never includes password_hash, and includes the joined role name", async () => {
    await POST(makeRequest("http://localhost/api/schools/TEA/employees", {
      method: "POST",
      body: JSON.stringify([makeEmployeeInput({ first_name: "List", last_name: "Check" })]),
    }));

    const response = await GET(makeRequest("http://localhost/api/schools/TEA/employees"), makeParams(SCHOOL_A));
    expect(response.status).toBe(200);
    const rows = await readJson(response);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row: Record<string, unknown>) => !("password_hash" in row))).toBe(true);
    expect(rows.some((row: Record<string, unknown>) => row.role_name === "Teacher")).toBe(true);
  });
});

describe("DELETE /api/schools/:school_id/employees (remove)", () => {
  it("removes the employee", async () => {
    const [created] = await readJson(await POST(makeRequest("http://localhost/api/schools/TEA/employees", {
      method: "POST",
      body: JSON.stringify([makeEmployeeInput({ first_name: "ToDelete", last_name: "Employee" })]),
    })));

    const response = await DELETE(
      makeRequest(`http://localhost/api/schools/TEA/employees?employee_id=${created.employee_id}`, { method: "DELETE" }),
      makeParams(SCHOOL_A)
    );
    expect(response.status).toBe(200);

    const remaining = await query("SELECT 1 FROM employees WHERE employee_id = $1", [created.employee_id]);
    expect(remaining.rowCount).toBe(0);
  });

  it("rejects a delete request missing employee_id", async () => {
    const response = await DELETE(makeRequest("http://localhost/api/schools/TEA/employees", { method: "DELETE" }), makeParams(SCHOOL_A));
    expect(response.status).toBe(400);
  });
});

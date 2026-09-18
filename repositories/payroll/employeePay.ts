import { query } from "../../lib/db";

export type EmployeePayRow = {
  employee_id: number;
  first_name: string;
  last_name: string;
  email: string;
  role_name: string;
  basic_salary: string | null;
  transport_allowance: string;
  housing_allowance: string;
  paye_deduction: string;
  pension_deduction: string;
};

/** Everyone on the books at this school, with whatever pay is recorded for them. */
export async function listEmployeePay(school_id: string): Promise<EmployeePayRow[]> {
  const result = await query(
    `
    SELECT
      e.employee_id::int AS employee_id,
      e.first_name,
      e.last_name,
      e.email,
      r.role_name,
      e.basic_salary,
      e.transport_allowance,
      e.housing_allowance,
      e.paye_deduction,
      e.pension_deduction
    FROM employees e
    JOIN roles r ON r.role_id = e.role_id
    WHERE e.school_id = $1
      AND e.deleted_at IS NULL
    ORDER BY e.last_name, e.first_name
    `,
    [school_id]
  );

  return result.rows as EmployeePayRow[];
}

export class EmployeePayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmployeePayError";
  }
}

export type EmployeePayUpdate = {
  employee_id: number;
  basic_salary: number | null;
  transport_allowance: number;
  housing_allowance: number;
  paye_deduction: number;
  pension_deduction: number;
};

/**
 * Updates one employee's pay.
 *
 * Scoped by school_id as well as employee_id so an administrator switched to
 * one school cannot edit another school's payroll by passing its ids.
 */
export async function updateEmployeePay(school_id: string, update: EmployeePayUpdate) {
  const result = await query(
    `
    UPDATE employees
    SET basic_salary        = $3,
        transport_allowance = $4,
        housing_allowance   = $5,
        paye_deduction      = $6,
        pension_deduction   = $7
    WHERE employee_id = $2
      AND school_id = $1
      AND deleted_at IS NULL
    RETURNING
      employee_id::int AS employee_id,
      basic_salary, transport_allowance, housing_allowance, paye_deduction, pension_deduction
    `,
    [
      school_id,
      update.employee_id,
      update.basic_salary,
      update.transport_allowance,
      update.housing_allowance,
      update.paye_deduction,
      update.pension_deduction,
    ]
  );

  if (result.rowCount === 0) {
    throw new EmployeePayError("That employee is not at this school, or has been removed.");
  }

  return result.rows[0];
}

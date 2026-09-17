import type { ReferenceTable } from "./referenceTable";

// One config per reference table. `dependents` lists everything that points at
// the row, taken from the foreign keys in migrations/001_initial_schema.sql —
// these drive the "still in use" check that guards deletion.

export const GENDERS: ReferenceTable = {
  table: "genders",
  idColumn: "gender_id",
  editableColumns: ["gender_name"],
  dependents: [{ table: "learners", column: "gender_id", noun: "learner" }],
  noun: "gender",
};

export const CLASS_CATEGORIES: ReferenceTable = {
  table: "class_categories",
  idColumn: "class_category_id",
  editableColumns: ["class_name"],
  dependents: [
    { table: "enrolments", column: "class_category_id", noun: "enrolment" },
    { table: "income_category_classes", column: "class_category_id", noun: "fee configuration" },
  ],
  noun: "class category",
};

export const ACADEMIC_YEARS: ReferenceTable = {
  table: "academic_years",
  idColumn: "academic_year_id",
  editableColumns: ["academic_year_name", "start_date", "end_date"],
  dependents: [
    { table: "enrolments", column: "academic_year_id", noun: "enrolment" },
    { table: "charges", column: "academic_year_id", noun: "charge" },
  ],
  noun: "academic year",
};

export const PAYMENT_PERIODS: ReferenceTable = {
  table: "payment_periods",
  idColumn: "payment_period_id",
  editableColumns: ["period_name"],
  dependents: [
    { table: "charges", column: "payment_period_id", noun: "charge" },
    { table: "income_category_periods", column: "payment_period_id", noun: "fee configuration" },
  ],
  noun: "payment period",
};

export const PAYMENT_METHODS: ReferenceTable = {
  table: "payment_methods",
  idColumn: "payment_method_id",
  editableColumns: ["method_name"],
  dependents: [{ table: "payments", column: "payment_method_id", noun: "payment" }],
  noun: "payment method",
};

export const INCOME_CATEGORIES: ReferenceTable = {
  table: "income_categories",
  idColumn: "income_category_id",
  editableColumns: ["income_name", "income_limit"],
  dependents: [{ table: "charges", column: "income_category_id", noun: "charge" }],
  noun: "income category",
};

// The only table whose foreign key cascades (expenses.fk_expense_category is
// ON DELETE CASCADE, so that deleting a school works). Without this dependent
// check the database would delete every expense in the category.
export const EXPENSE_CATEGORIES: ReferenceTable = {
  table: "expense_categories",
  idColumn: "expense_category_id",
  editableColumns: ["expense_name"],
  dependents: [{ table: "expenses", column: "expense_category_id", noun: "expense" }],
  noun: "expense category",
};

export const ROLES: ReferenceTable = {
  table: "roles",
  idColumn: "role_id",
  editableColumns: ["role_name"],
  dependents: [{ table: "employees", column: "role_id", noun: "employee" }],
  noun: "role",
};

// Per-entity validation for the bulk create endpoints. Deliberately mirrors
// the constraints the database already enforces (amount > 0, required FKs,
// real dates) so a bad record is rejected with a clear, per-record message
// instead of surfacing as a raw constraint violation.

import { isoDate, positiveAmount, positiveId, requiredText, type RecordError } from './bulk';

export function validateLearners(records: Record<string, unknown>[]): RecordError[] {
  const errors: RecordError[] = [];
  records.forEach((record, index) => {
    requiredText(record.school_id, 'school_id', index, errors);
    requiredText(record.first_name, 'first_name', index, errors);
    requiredText(record.last_name, 'last_name', index, errors);
    positiveId(record.gender_id, 'gender_id', index, errors);
    positiveId(record.class_category_id, 'class_category_id', index, errors);
    positiveId(record.academic_year_id, 'academic_year_id', index, errors);
    isoDate(record.date_of_birth, 'date_of_birth', index, errors);
  });
  return errors;
}

export function validateExpenses(records: Record<string, unknown>[]): RecordError[] {
  const errors: RecordError[] = [];
  records.forEach((record, index) => {
    positiveId(record.expense_category_id, 'expense_category_id', index, errors);
    positiveAmount(record.amount, 'amount', index, errors);
    isoDate(record.expense_date, 'expense_date', index, errors);
    // description is nullable in the schema, so it is not required here.
  });
  return errors;
}

export function validatePayments(records: Record<string, unknown>[]): RecordError[] {
  const errors: RecordError[] = [];
  records.forEach((record, index) => {
    requiredText(record.learner_id, 'learner_id', index, errors);
    positiveId(record.enrolment_id, 'enrolment_id', index, errors);
    positiveId(record.payment_period_id, 'payment_period_id', index, errors);
    positiveId(record.academic_year_id, 'academic_year_id', index, errors);
    positiveId(record.payment_method_id, 'payment_method_id', index, errors);

    const incomeCategories = record.income_categories;
    if (!Array.isArray(incomeCategories) || incomeCategories.length === 0) {
      errors.push({ index, field: 'income_categories', message: 'At least one income category is required' });
      return;
    }

    // A payment can cover several fees for the same learner, so each line is
    // validated separately. With more than one line the message names which
    // line failed; with a single line it stays as-is.
    incomeCategories.forEach((line: unknown, lineIndex: number) => {
      const entry = (line ?? {}) as Record<string, unknown>;
      const lineErrors: RecordError[] = [];
      positiveId(entry.income_category_id, 'income_category_id', index, lineErrors);
      positiveAmount(entry.amount, 'amount', index, lineErrors);

      for (const lineError of lineErrors) {
        errors.push(
          incomeCategories.length > 1
            ? { ...lineError, message: `Payment line ${lineIndex + 1}: ${lineError.message}` }
            : lineError,
        );
      }
    });
  });
  return errors;
}

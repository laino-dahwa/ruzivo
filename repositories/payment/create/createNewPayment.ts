import { transaction } from "../../../lib/db";

export type CreateChargesWithPaymentsInput = {
  learner_id: string;
  enrolment_id: number;
  payment_period_id: number;
  academic_year_id: number;
  payment_method_id: number;

  income_categories: {
    income_category_id: number;
    amount: number;
  }[];
};

export async function createChargesWithPayments(
  input: CreateChargesWithPaymentsInput
) {
  if (input.income_categories.length === 0) {
    return [];
  }

  return transaction(async (client) => {
    const results = [];

    for (const incomeCategory of input.income_categories) {
      /*
       * 1. Create the charge
       */
      const chargeResult = await client.query(
        `
        INSERT INTO charges (
          learner_id,
          enrolment_id,
          income_category_id,
          payment_period_id,
          academic_year_id
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          charge_id,
          learner_id,
          enrolment_id,
          income_category_id,
          payment_period_id,
          academic_year_id,
          created_at
        `,
        [
          input.learner_id,
          input.enrolment_id,
          incomeCategory.income_category_id,
          input.payment_period_id,
          input.academic_year_id,
        ]
      );

      const charge = chargeResult.rows[0];

      /*
       * 2. Create the payment
       */
      const paymentResult = await client.query(
        `
        INSERT INTO payments (
          amount,
          payment_method_id
        )
        VALUES ($1, $2)
        RETURNING
          payment_id,
          amount,
          payment_method_id,
          paid_at
        `,
        [
          incomeCategory.amount,
          input.payment_method_id,
        ]
      );

      const payment = paymentResult.rows[0];

      /*
       * 3. Allocate this payment to this charge
       */
      const allocationResult = await client.query(
        `
        INSERT INTO payment_allocations (
          payment_id,
          charge_id
        )
        VALUES ($1, $2)
        RETURNING
          allocation_id,
          payment_id,
          charge_id
        `,
        [
          payment.payment_id,
          charge.charge_id,
        ]
      );

      const allocation = allocationResult.rows[0];

      /*
       * Keep the three related records together
       */
      results.push({
        charge,
        payment,
        allocation,
      });
    }

    return results;
  });
}
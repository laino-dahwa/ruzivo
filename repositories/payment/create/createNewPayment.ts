import { transaction } from "../../../lib/db";

export type CreateChargeWithPaymentInput = {
  learner_id: string;
  enrolment_id: number;
  income_category_id: number;
  payment_period_id: number;
  academic_year_id: number;

  amount: number;
  payment_method_id: number;
  reference: string;
};

export async function createChargeWithPayment(input: CreateChargeWithPaymentInput) {
  
    return transaction(async (client) => {

    // 1. Create the charge
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
      RETURNING charge_id
      `,
      [
        input.learner_id,
        input.enrolment_id,
        input.income_category_id,
        input.payment_period_id,
        input.academic_year_id,
      ]
    );

    const chargeId = chargeResult.rows[0].charge_id;


    // 2. Create the payment
    const paymentResult = await client.query(
      `
      INSERT INTO payments (
        amount,
        payment_method_id,
        reference
      )
      VALUES ($1, $2, $3)
      RETURNING payment_id
      `,
      [
        input.amount,
        input.payment_method_id,
        input.reference,
      ]
    );

    const paymentId =
      paymentResult.rows[0].payment_id;


    // 3. Allocate the payment to the charge
    await client.query(
      `
      INSERT INTO payment_allocations (
        payment_id,
        charge_id
      )
      VALUES ($1, $2)
      `,
      [
        paymentId,
        chargeId,
      ]
    );


    // 4. Return everything useful
    return {
      charge_id: chargeId,
      payment_id: paymentId,
    };
  });
}
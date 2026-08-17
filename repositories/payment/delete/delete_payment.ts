import { transaction } from "../../../lib/db";

export async function deleteCharge(chargeId: number) {
  return transaction(async (client) => {

    // 1. Find the payment(s) allocated to this charge
    const allocationResult = await client.query(
      `
      SELECT payment_id
      FROM payment_allocations
      WHERE charge_id = $1
      `,
      [chargeId]
    );

    const paymentIds = allocationResult.rows.map(
      row => row.payment_id
    );


    // 2. Delete the allocation(s)
    await client.query(
      `
      DELETE FROM payment_allocations
      WHERE charge_id = $1
      `,
      [chargeId]
    );


    // 3. Delete the charge
    const chargeResult = await client.query(
      `
      DELETE FROM charges
      WHERE charge_id = $1
      RETURNING
        charge_id,
        learner_id,
        enrolment_id,
        income_category_id,
        payment_period_id,
        academic_year_id
      `,
      [chargeId]
    );

    if (chargeResult.rowCount === 0) {
      throw new Error("Charge not found.");
    }


    // 4. Delete payments that no longer have
    //    any allocations
    if (paymentIds.length > 0) {

      await client.query(
        `
        DELETE FROM payments AS p
        WHERE p.payment_id = ANY($1::bigint[])
          AND NOT EXISTS (
            SELECT 1
            FROM payment_allocations AS pa
            WHERE pa.payment_id = p.payment_id
          )
        `,
        [paymentIds]
      );
    }


    return chargeResult.rows[0];
  });
}
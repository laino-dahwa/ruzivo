import { query } from "../../../lib/db";

type UpdatePaymentPeriod = {
  school_id :string
  period_name :string,
 
};

export async function UpdatePaymentPeriod(payment_periods: UpdatePaymentPeriod[]) {
  if (payment_periods.length === 0) {
    return [];
  }

  const values: unknown[] = [];

  const placeholders = payment_periods.map((payment_period, index) => {
    const offset = index * 2;

    values.push(
      payment_period.school_id,
      payment_period.period_name ?? null
    );

    return `(
      $${offset + 1},
      $${offset + 2}
   
    )`;
  });

  const result = await query(
    `
    UPDATE payment_periods AS s
    SET
      period_name = COALESCE(v.period_name, s.period_name),
 

    FROM (
      VALUES
        ${placeholders.join(",")}
    ) AS v(
      school_id,
      period_name,
      
    )

    WHERE s.school_id = v.school_id

    RETURNING
      s.school_id,
      s.period_name,
     ;
    `,
    values
  );

  return result.rows;
}
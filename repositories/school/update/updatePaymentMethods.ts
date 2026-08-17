import { query } from "../../../lib/db";

type UpdatePaymentMethods = {
  school_id :string
  method_name :string,
};

export async function UpdatePaymentMethod(payment_methods: UpdatePaymentMethods[]) {
  if (payment_methods.length === 0) {
    return [];
  }

  const values: unknown[] = [];

  const placeholders = payment_methods.map((payment_method, index) => {
    const offset = index * 2;

    values.push(
      payment_method.school_id,
      payment_method.method_name?? null
    
    );

    return `(
      $${offset + 1},
      $${offset + 2},

    )`;
  });

  const result = await query(
    `
    UPDATE payment_methods AS s
    SET
      method_name = COALESCE(v.method_name, s.method_name),
   

    FROM (
      VALUES
        ${placeholders.join(",")}
    ) AS v(
      school_id,
      method_name,
    
    )

    WHERE s.school_id = v.school_id

    RETURNING
      s.school_id,
      s.method_name,

    `,
    values
  );

  return result.rows;
}
import { query } from "../../../lib/db";

export async function getIncomeCategories(school_id: string) {
    const result = await query(`
        SELECT
            ic.*,
            COALESCE(array_agg(DISTINCT icc.class_category_id) FILTER (WHERE icc.class_category_id IS NOT NULL), '{}') AS class_category_ids,
            COALESCE(array_agg(DISTINCT icl.learner_id) FILTER (WHERE icl.learner_id IS NOT NULL), '{}') AS learner_ids,
            COALESCE(array_agg(DISTINCT icp.payment_period_id) FILTER (WHERE icp.payment_period_id IS NOT NULL), '{}') AS payment_period_ids
        FROM income_categories ic
        LEFT JOIN income_category_classes icc ON icc.income_category_id = ic.income_category_id
        LEFT JOIN income_category_learners icl ON icl.income_category_id = ic.income_category_id
        LEFT JOIN income_category_periods icp ON icp.income_category_id = ic.income_category_id
        WHERE ic.school_id = $1
        GROUP BY ic.income_category_id
        ORDER BY ic.income_name`,
        [school_id]
    );

    return result.rows;
}

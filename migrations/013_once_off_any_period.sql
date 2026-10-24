-- Up Migration
--
-- Once-off fees are no longer set up for particular payment periods. One can
-- be paid in any period, or never (it is never listed as owed just for
-- existing). Whatever period it is paid in, the limit applies to that period:
-- 5 of 20 paid in January leaves 15 owing for January. Enforced in
-- repositories/payment/create/createNewPayment.ts.
--
-- Existing once-off fees drop the periods they were set up for, so they
-- behave the same way as new ones.

DELETE FROM income_category_periods
WHERE income_category_id IN (SELECT income_category_id FROM income_categories WHERE priority = 'ONCE_OFF');

UPDATE income_categories
SET period_applicability = 'ALL_PERIODS'
WHERE priority = 'ONCE_OFF';

-- Down Migration

-- Nothing to restore: which periods a once-off fee used to be limited to is
-- not kept, and every once-off fee stays valid as "all periods".
SELECT 1;

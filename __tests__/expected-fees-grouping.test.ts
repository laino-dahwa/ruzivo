import { describe, expect, it } from "vitest";
import { feeKeyOf, groupExpectedFeesByLearner, sortExpectedFeeCards } from "../lib/expected-fees/groupByLearner";
import { parseExpectedFeeAction } from "../lib/expected-fees/parseAction";
import type { ExpectedFeeRow } from "../types/expected-fees";

function row(overrides: Partial<ExpectedFeeRow>): ExpectedFeeRow {
  return {
    learner_id: "L1", first_name: "Rudo", last_name: "Moyo", class_category_id: 1, class_name: "Grade 2",
    income_category_id: 1, income_name: "Tuition", priority: "MANDATORY",
    payment_period_id: 1, period_name: "January", academic_year_id: 1, academic_year_name: "2026",
    decision: "PENDING", amount: "100.00", paid: "0", source: null, reason: null,
    decided_by: null, decided_at: null, can_undo: false,
    ...overrides,
  };
}

describe("groupExpectedFeesByLearner", () => {
  it("adds a learner's mandatory and optional fees into one card", () => {
    const [card] = groupExpectedFeesByLearner([
      row({ amount: "100.00" }),
      row({ income_category_id: 2, income_name: "Swimming", priority: "OPTIONAL", amount: "20.00" }),
      row({ income_category_id: 3, income_name: "Uniform", priority: "ONCE_OFF", amount: "5.50" }),
    ]);
    expect(card).toMatchObject({ total: 125.5, mandatory: 100, optional: 25.5 });
    expect(card.rows).toHaveLength(3);
  });

  it("keeps each learner separate, and lists mandatory fees first", () => {
    const cards = groupExpectedFeesByLearner([
      row({ learner_id: "L2", first_name: "Tendai", priority: "OPTIONAL", income_name: "Swimming" }),
      row({ learner_id: "L1", priority: "OPTIONAL", income_name: "Swimming", income_category_id: 2 }),
      row({ learner_id: "L1" }),
    ]);
    expect(cards.map((c) => c.learner_id).sort()).toEqual(["L1", "L2"]);
    expect(cards.find((c) => c.learner_id === "L1")!.rows.map((r) => r.priority)).toEqual(["MANDATORY", "OPTIONAL"]);
  });

  it("counts a fee with no amount as nothing", () => {
    const [card] = groupExpectedFeesByLearner([row({ amount: null })]);
    expect(card.total).toBe(0);
  });
});

describe("sortExpectedFeeCards", () => {
  const cards = groupExpectedFeesByLearner([
    row({ learner_id: "A", first_name: "Zara", class_name: "Grade 10", amount: "50" }),
    row({ learner_id: "B", first_name: "Amy", class_name: "Grade 2", amount: "50" }),
    row({ learner_id: "C", first_name: "Bob", class_name: "Grade 3", amount: "300" }),
  ]);

  it("puts the largest amount first, breaking ties by name", () => {
    expect(sortExpectedFeeCards(cards, "largest").map((c) => c.first_name)).toEqual(["Bob", "Amy", "Zara"]);
  });

  it("sorts classes in natural order, so Grade 2 comes before Grade 10", () => {
    expect(sortExpectedFeeCards(cards, "class").map((c) => c.class_name)).toEqual(["Grade 2", "Grade 3", "Grade 10"]);
  });
});

describe("feeKeyOf", () => {
  it("names a row by learner, fee, period and year, and has no key for an exemption", () => {
    expect(feeKeyOf(row({}))).toEqual({ learner_id: "L1", income_category_id: 1, payment_period_id: 1, academic_year_id: 1 });
    expect(feeKeyOf(row({ decision: "EXEMPT", payment_period_id: null, academic_year_id: null }))).toBeNull();
  });
});

describe("parseExpectedFeeAction", () => {
  const key = { learner_id: "L1", income_category_id: 1, payment_period_id: 2, academic_year_id: 3 };

  it("accepts each action with the items it needs", () => {
    expect(parseExpectedFeeAction({ action: "ACCEPT", items: [key] })).toEqual({ ok: true, action: { action: "ACCEPT", items: [key] } });
    expect(parseExpectedFeeAction({ action: "EXEMPT", items: [{ learner_id: "L1", income_category_id: 1 }], reason: "  Scholarship " }))
      .toEqual({ ok: true, action: { action: "EXEMPT", items: [{ learner_id: "L1", income_category_id: 1 }], reason: "Scholarship" } });
  });

  it("refuses a forever-deny without a reason, empty or malformed items, and unknown actions", () => {
    expect(parseExpectedFeeAction({ action: "EXEMPT", items: [{ learner_id: "L1", income_category_id: 1 }] }).ok).toBe(false);
    expect(parseExpectedFeeAction({ action: "ACCEPT", items: [] }).ok).toBe(false);
    expect(parseExpectedFeeAction({ action: "SKIP", items: [{ ...key, payment_period_id: "2" }] }).ok).toBe(false);
    expect(parseExpectedFeeAction({ action: "NOPE", items: [key] }).ok).toBe(false);
    expect(parseExpectedFeeAction(null).ok).toBe(false);
  });
});

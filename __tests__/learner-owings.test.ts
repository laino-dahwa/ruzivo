import { describe, expect, it } from "vitest";
import { groupObligationsByLearner, paymentProgress, sortLearnerOwings } from "../lib/owing/groupObligationsByLearner";
import type { ObligationRow } from "../types/payment";

function row(overrides: Partial<ObligationRow>): ObligationRow {
  return {
    learner_id: "L1",
    first_name: "Tendai",
    last_name: "Moyo",
    class_name: "Grade 4",
    income_name: "Tuition",
    priority: "MANDATORY",
    period_name: "September",
    academic_year_name: "2026",
    expected: "500.00",
    paid: "0.00",
    balance: "500.00",
    status: "NO_PAYMENT",
    ...overrides,
  };
}

describe("groupObligationsByLearner", () => {
  it("adds a learner's mandatory and optional owing into one total", () => {
    const [learner] = groupObligationsByLearner([
      row({ income_name: "Tuition", period_name: "September", paid: "200.00", balance: "300.00", status: "PARTIALLY_PAID" }),
      row({ income_name: "Tuition", period_name: "October" }),
      row({ income_name: "Swimming", priority: "OPTIONAL", expected: "90.00", paid: "0.00", balance: "90.00" }),
    ]);

    expect(learner.mandatoryOwing).toBe(800);
    expect(learner.optionalOwing).toBe(90);
    expect(learner.totalOwing).toBe(890);
    expect(learner.paid).toBe(200);
    expect(learner.billed).toBe(1090);
  });

  it("keeps each learner separate", () => {
    const learners = groupObligationsByLearner([
      row({ learner_id: "L1" }),
      row({ learner_id: "L2", first_name: "Rudo", balance: "100.00" }),
      row({ learner_id: "L1", period_name: "October" }),
    ]);
    expect(learners.map((l) => [l.learner_id, l.totalOwing])).toEqual([["L1", 1000], ["L2", 100]]);
  });

  it("lists only outstanding fees, mandatory before optional", () => {
    const [learner] = groupObligationsByLearner([
      row({ income_name: "Swimming", priority: "OPTIONAL", balance: "90.00" }),
      row({ income_name: "Levy", paid: "200.00", balance: "0.00", status: "FULLY_PAID" }),
      row({ income_name: "Tuition", balance: "500.00" }),
    ]);
    expect(learner.outstanding.map((r) => r.income_name)).toEqual(["Tuition", "Swimming"]);
  });

  it("counts a fully paid learner as owing nothing, but still counts what they paid", () => {
    const [learner] = groupObligationsByLearner([row({ paid: "500.00", balance: "0.00", status: "FULLY_PAID" })]);
    expect(learner.totalOwing).toBe(0);
    expect(learner.paid).toBe(500);
    expect(paymentProgress(learner)).toBe("PAID_UP");
  });

  it("adds nothing owing for a fee with no limit, while keeping what was paid", () => {
    const [learner] = groupObligationsByLearner([
      row({ expected: null, balance: null, status: null, paid: "40.00", priority: "OPTIONAL" }),
      row({ balance: "60.00" }),
    ]);
    expect(learner.totalOwing).toBe(60);
    expect(learner.paid).toBe(40);
    expect(learner.billed).toBe(100);
  });
});

describe("paymentProgress", () => {
  it("tells nothing paid, part paid and nearly paid apart", () => {
    expect(paymentProgress({ totalOwing: 600, paid: 0, billed: 600 })).toBe("NOTHING_PAID");
    expect(paymentProgress({ totalOwing: 1240, paid: 560, billed: 1800 })).toBe("PART_PAID");
    expect(paymentProgress({ totalOwing: 95, paid: 905, billed: 1000 })).toBe("NEARLY_PAID");
  });
});

describe("sortLearnerOwings", () => {
  const learners = groupObligationsByLearner([
    row({ learner_id: "A", first_name: "Chipo", class_name: "Grade 10", balance: "100.00" }),
    row({ learner_id: "B", first_name: "Anesu", class_name: "Grade 2", balance: "900.00" }),
    row({ learner_id: "C", first_name: "Batsi", class_name: "Grade 2", balance: "100.00" }),
  ]);

  it("puts the most owed first, breaking ties by name", () => {
    expect(sortLearnerOwings(learners, "most-owing").map((l) => l.learner_id)).toEqual(["B", "C", "A"]);
  });

  it("sorts by name", () => {
    expect(sortLearnerOwings(learners, "name").map((l) => l.first_name)).toEqual(["Anesu", "Batsi", "Chipo"]);
  });

  it("sorts classes in natural order, so Grade 2 comes before Grade 10", () => {
    expect(sortLearnerOwings(learners, "class").map((l) => l.learner_id)).toEqual(["B", "C", "A"]);
  });
});

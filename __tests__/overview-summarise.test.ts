import { describe, expect, it } from "vitest";
import { rollUpDaily, topDebtors } from "../lib/overview/summarise";
import type { DailyTotal, OwingReportRow } from "../types/report";

function day(date: string, income: number, expenses: number): DailyTotal {
  return { date, income, expenses };
}

/** A whole year of daily points, one per day. */
function yearOfDays(): DailyTotal[] {
  const days: DailyTotal[] = [];
  for (let month = 1; month <= 12; month++) {
    const lastDay = new Date(Date.UTC(2026, month, 0)).getUTCDate();
    for (let d = 1; d <= lastDay; d++) {
      days.push(day(`2026-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`, 10, 4));
    }
  }
  return days;
}

describe("rolling the trend up", () => {
  it("leaves a short window alone", () => {
    const short = [day("2026-03-01", 100, 20), day("2026-03-02", 50, 10)];
    expect(rollUpDaily(short)).toEqual(short);
  });

  it("groups a long window into months and sums each one", () => {
    const rolled = rollUpDaily(yearOfDays());

    // 365 bars in a card a few hundred pixels wide is unreadable; 12 is not.
    expect(rolled).toHaveLength(12);
    expect(rolled[0].date).toBe("2026-01-01");
    expect(rolled[11].date).toBe("2026-12-01");

    // January: 31 days at 10 in and 4 out.
    expect(rolled[0].income).toBe(310);
    expect(rolled[0].expenses).toBe(124);

    // February 2026 is not a leap year — 28 days, so the roll-up must not
    // assume a fixed month length.
    expect(rolled[1].income).toBe(280);
  });

  it("keeps months in order even if the input is not", () => {
    const shuffled = [...yearOfDays()].reverse();
    const rolled = rollUpDaily(shuffled);
    expect(rolled.map((entry) => entry.date.slice(0, 7))).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
    ]);
  });

  it("does not lose any money in the roll-up", () => {
    const days = yearOfDays();
    const rolled = rollUpDaily(days);
    const totalBefore = days.reduce((sum, entry) => sum + entry.income, 0);
    const totalAfter = rolled.reduce((sum, entry) => sum + entry.income, 0);
    expect(totalAfter).toBe(totalBefore);
  });

  it("copes with an empty window", () => {
    expect(rollUpDaily([])).toEqual([]);
  });
});

function owing(learner_id: string, first_name: string, balance: string, income_name = "School Fees"): OwingReportRow {
  return {
    charge_id: 1,
    charge_date: "2026-03-01",
    learner_id,
    first_name,
    last_name: "Moyo",
    class_name: "Grade 4",
    income_name,
    period_name: "January",
    academic_year_name: "2026",
    expected: "500",
    paid: "0",
    balance,
    status: "Unpaid",
  };
}

describe("ranking who owes the most", () => {
  it("totals a learner's unpaid fees rather than ranking individual charges", () => {
    // Tendai owes more in total across three fees than Rudo does on one, and
    // is the one who actually needs chasing first.
    const ranked = topDebtors([
      owing("L1", "Tendai", "150", "School Fees"),
      owing("L1", "Tendai", "120", "Transport"),
      owing("L1", "Tendai", "100", "Uniform"),
      owing("L2", "Rudo", "300", "School Fees"),
    ]);

    expect(ranked.map((entry) => entry.name)).toEqual(["Tendai Moyo", "Rudo Moyo"]);
    expect(ranked[0].balance).toBe(370);
    expect(ranked[0].fees).toBe(3);
    expect(ranked[1].fees).toBe(1);
  });

  it("sorts largest first", () => {
    const ranked = topDebtors([owing("L1", "Small", "10"), owing("L2", "Big", "900"), owing("L3", "Middle", "400")]);
    expect(ranked.map((entry) => entry.balance)).toEqual([900, 400, 10]);
  });

  it("keeps each learner exactly once", () => {
    const ranked = topDebtors([owing("L1", "Tendai", "50"), owing("L1", "Tendai", "50"), owing("L1", "Tendai", "50")]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].balance).toBe(150);
  });

  it("copes with nothing outstanding", () => {
    expect(topDebtors([])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { GROUPING_THRESHOLD, NAV_GROUP_ORDER, nav } from "../components/layout/nav-config";
import { ROUTE_CAPABILITIES, can, type AccessLevel } from "../lib/auth/permissions";

function visibleTo(level: AccessLevel) {
  return nav.filter((item) => can(level, item.capability));
}

describe("the sidebar and the page guards agree", () => {
  it("gates every link on the same capability as the page behind it", () => {
    // These are enforced in two different places — the sidebar filter and
    // lib/auth/page-guard.ts. If they ever disagree, someone sees a link that
    // bounces them straight back, or a page they were never shown a way to.
    for (const item of nav) {
      const routeCapability = ROUTE_CAPABILITIES[item.href as keyof typeof ROUTE_CAPABILITIES];
      expect(routeCapability, `no page capability registered for ${item.href}`).toBeDefined();
      expect(item.capability, `sidebar and page guard disagree about ${item.href}`).toBe(routeCapability);
    }
  });

  it("has a link for every gated route", () => {
    const linked = new Set(nav.map((item) => item.href));
    for (const href of Object.keys(ROUTE_CAPABILITIES)) {
      expect(linked, `${href} is gated but has no sidebar link`).toContain(href);
    }
  });
});

describe("what each role sees", () => {
  it("shows an administrator everything", () => {
    expect(visibleTo("ADMIN")).toHaveLength(nav.length);
  });

  it("shows a cashier only the five pages they can work in", () => {
    expect(visibleTo("CASHIER").map((item) => item.label)).toEqual([
      "Payments",
      "Balances",
      "Expected fees",
      "Expenses",
      "Learners",
    ]);
  });

  it("keeps salaries, documents, reports and setup away from a cashier", () => {
    const labels = visibleTo("CASHIER").map((item) => item.label);
    for (const hidden of ["Payroll", "Documents", "Reports", "Setup", "Overview"]) {
      expect(labels).not.toContain(hidden);
    }
  });
});

describe("grouping", () => {
  it("groups the administrator's list and leaves the cashier's flat", () => {
    // Headings only earn their vertical space once there is enough to sort
    // through; five items read fine as one run.
    expect(visibleTo("ADMIN").length).toBeGreaterThanOrEqual(GROUPING_THRESHOLD);
    expect(visibleTo("CASHIER").length).toBeLessThan(GROUPING_THRESHOLD);
  });

  it("puts every link in a known group, except the one that stands alone", () => {
    const ungrouped = nav.filter((item) => !item.group);
    expect(ungrouped.map((item) => item.label)).toEqual(["Overview"]);

    for (const item of nav.filter((entry) => entry.group)) {
      expect(NAV_GROUP_ORDER, `${item.label} is in an unknown group`).toContain(item.group);
    }
  });

  it("keeps each group's links together, so rendering by group preserves the order", () => {
    // The sidebar renders group by group. If the array interleaved them, the
    // on-screen order would silently stop matching this file.
    const groups = nav.filter((item) => item.group).map((item) => item.group!);
    const firstSeen = [...new Set(groups)];
    expect(groups).toEqual(firstSeen.flatMap((group) => groups.filter((entry) => entry === group)));
  });
});

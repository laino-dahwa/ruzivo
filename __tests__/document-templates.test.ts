import { describe, expect, it } from "vitest";
import { MERGE_FIELD_LABELS, TEMPLATES, formatReference, mergeTemplate, templateFor } from "../lib/documents/templates";

const KNOWN_FIELDS = Object.keys(MERGE_FIELD_LABELS);

describe("document templates", () => {
  it("only uses placeholders the app can actually fill", () => {
    // A typo'd placeholder is not a crash — it prints "{{learnr_name}}"
    // verbatim on an official school letter, which is the kind of mistake
    // nobody notices until it is in a parent's hands.
    for (const template of TEMPLATES) {
      const placeholders = [...template.body.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
      for (const placeholder of placeholders) {
        expect(KNOWN_FIELDS, `${template.type} uses {{${placeholder}}}`).toContain(placeholder);
      }
    }
  });

  it("gives every template its own reference code, so references cannot collide", () => {
    const codes = TEMPLATES.map((template) => template.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("only asks for a learner where the document is about one", () => {
    expect(templateFor("transfer_letter")?.requiresLearner).toBe(true);
    expect(templateFor("acknowledgement_letter")?.requiresLearner).toBe(true);
    expect(templateFor("fee_statement")?.requiresLearner).toBe(true);
    // Addressed to the whole school, so demanding a learner would be wrong.
    expect(templateFor("newsletter")?.requiresLearner).toBe(false);
    expect(templateFor("general_letter")?.requiresLearner).toBe(false);
  });

  it("attaches the locked figures block only to the statement", () => {
    expect(templateFor("fee_statement")?.includesStatement).toBe(true);
    for (const template of TEMPLATES.filter((item) => item.type !== "fee_statement")) {
      expect(template.includesStatement).toBe(false);
    }
  });
});

describe("the acknowledgement letter", () => {
  const template = templateFor("acknowledgement_letter")!;

  it("confirms current enrolment rather than acknowledging a payment", () => {
    // It is proof that a learner attends this school, requested by embassies,
    // banks, sponsors and medical aid schemes. It is emphatically not a
    // receipt, and an earlier version of this template got that wrong.
    expect(template.body).toMatch(/currently enrolled/i);
    expect(template.body).not.toMatch(/payment|receipt|paid/i);
  });

  it("is addressed to whoever needs it, not to the parents", () => {
    expect(template.body).toMatch(/to whom it may concern/i);
    expect(template.body).not.toMatch(/Dear Parent/i);
  });

  it("states the class and year, which is what makes it useful as proof", () => {
    expect(template.body).toContain("{{class_name}}");
    expect(template.body).toContain("{{academic_year}}");
  });

  it("points the reader at the reference so the letter can be checked", () => {
    expect(template.body).toMatch(/reference number/i);
  });
});

describe("merging", () => {
  it("fills in what it knows", () => {
    const merged = mergeTemplate("<p>{{learner_name}} of {{class_name}}</p>", {
      learner_name: "Tendai Moyo",
      class_name: "Grade 4",
    });
    expect(merged).toBe("<p>Tendai Moyo of Grade 4</p>");
  });

  it("leaves a placeholder visible when there is nothing to put there", () => {
    // Better an obvious "{{class_name}}" the user deletes than a silent gap
    // that reads as though the learner has no class.
    const merged = mergeTemplate("<p>{{learner_name}} of {{class_name}}</p>", { learner_name: "Tendai Moyo" });
    expect(merged).toBe("<p>Tendai Moyo of {{class_name}}</p>");
  });
});

describe("references", () => {
  it("is built from the school, the document type and a padded sequence", () => {
    expect(formatReference("ssv", "AL", 147)).toBe("SSV-AL-000147");
  });

  it("trims the blank padding Postgres returns on CHAR(4) school ids", () => {
    expect(formatReference("SSV ", "TL", 1)).toBe("SSV-TL-000001");
  });
});

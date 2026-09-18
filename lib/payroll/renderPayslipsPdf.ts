import PDFDocument from "pdfkit";
import { computePay, payComponentsOf, periodLabel, type PayBreakdown } from "./compute";
import { formatCurrency } from "../currency";

type Doc = PDFKit.PDFDocument;

export type PayslipLine = {
  employee_label: string;
  role_label: string;
  employee_email: string | null;
  basic_salary: string | number;
  transport_allowance: string | number;
  housing_allowance: string | number;
  paye_deduction: string | number;
  pension_deduction: string | number;
};

export type PayslipsPdfOptions = {
  schoolName: string;
  schoolAddress?: string | null;
  schoolContact?: string | null;
  logo?: Buffer | null;
  periodYear: number;
  periodMonth: number;
  generatedAt: Date;
  generatedAtLabel: string;
  generatedByLabel: string;
  lines: PayslipLine[];
};

function contentWidth(doc: Doc): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

/** A label/amount row, label left and amount right-aligned on the same line. */
function amountRow(doc: Doc, label: string, value: string, options: { bold?: boolean; size?: number } = {}) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const size = options.size ?? 10;

  doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor("#000");
  const y = doc.y;
  doc.text(label, left, y, { width: width * 0.6 });
  doc.text(value, left + width * 0.6, y, { width: width * 0.4, align: "right" });
  doc.y = y + size + 5;
}

function rule(doc: Doc, weight = 0.5) {
  const left = doc.page.margins.left;
  doc.moveTo(left, doc.y).lineTo(left + contentWidth(doc), doc.y).lineWidth(weight).strokeColor("#999").stroke();
  doc.y += 6;
}

function drawHeader(doc: Doc, options: PayslipsPdfOptions) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  let textLeft = left;

  if (options.logo) {
    try {
      doc.image(options.logo, left, doc.y, { fit: [46, 46] });
      textLeft = left + 58;
    } catch {
      // An undecodable logo must not cost everyone their payslip.
    }
  }

  const top = doc.y;
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#000").text(options.schoolName, textLeft, top, { width: width - (textLeft - left) });
  doc.font("Helvetica").fontSize(8.5).fillColor("#444");
  if (options.schoolAddress) doc.text(options.schoolAddress, textLeft, doc.y, { width: width - (textLeft - left) });
  if (options.schoolContact) doc.text(options.schoolContact, textLeft, doc.y, { width: width - (textLeft - left) });

  doc.y = Math.max(doc.y, top + (options.logo ? 46 : 0)) + 8;
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.2).strokeColor("#000").stroke();
  doc.y += 14;

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#000")
    .text(`PAYSLIP — ${periodLabel(options.periodYear, options.periodMonth).toUpperCase()}`, left, doc.y, { width, align: "center" });
  doc.y += 14;
}

function drawEmployeeBlock(doc: Doc, line: PayslipLine) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  doc.rect(left, doc.y, width, 44).fillColor("#f4f4f4").fill();
  doc.fillColor("#000");

  const top = doc.y + 7;
  doc.font("Helvetica").fontSize(8).fillColor("#666").text("EMPLOYEE", left + 10, top);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(line.employee_label, left + 10, top + 11);

  doc.font("Helvetica").fontSize(8).fillColor("#666").text("ROLE", left + width * 0.55, top);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(line.role_label, left + width * 0.55, top + 11, { width: width * 0.4 });

  doc.y = top + 44;
}

function drawBreakdown(doc: Doc, pay: PayBreakdown) {
  const left = doc.page.margins.left;

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#666").text("EARNINGS", left, doc.y);
  doc.y += 14;
  amountRow(doc, "Basic salary", formatCurrency(pay.basic_salary));
  // Zero lines are left off: a payslip listing "$0.00" against allowances
  // nobody gets is noise, and invites the question of why it is there.
  if (pay.transport_allowance > 0) amountRow(doc, "Transport allowance", formatCurrency(pay.transport_allowance));
  if (pay.housing_allowance > 0) amountRow(doc, "Housing allowance", formatCurrency(pay.housing_allowance));
  rule(doc);
  amountRow(doc, "Gross pay", formatCurrency(pay.grossPay), { bold: true });

  doc.y += 10;

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#666").text("DEDUCTIONS", left, doc.y);
  doc.y += 14;
  if (pay.totalDeductions === 0) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor("#666").text("None", left, doc.y);
    doc.y += 16;
  } else {
    if (pay.paye_deduction > 0) amountRow(doc, "PAYE", formatCurrency(pay.paye_deduction));
    if (pay.pension_deduction > 0) amountRow(doc, "Pension", formatCurrency(pay.pension_deduction));
    rule(doc);
    amountRow(doc, "Total deductions", formatCurrency(pay.totalDeductions), { bold: true });
  }

  doc.y += 12;
  rule(doc, 1.2);
  amountRow(doc, "NET PAY", formatCurrency(pay.netPay), { bold: true, size: 13 });
  rule(doc, 1.2);
}

function drawFooter(doc: Doc, options: PayslipsPdfOptions, index: number, total: number) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const y = doc.page.height - doc.page.margins.bottom - 26;

  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor("#cccccc").stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor("#666");
  doc.text(
    `${periodLabel(options.periodYear, options.periodMonth)} payroll  ·  Generated ${options.generatedAtLabel} by ${options.generatedByLabel}`,
    left,
    y + 6,
    { width, align: "left" }
  );
  doc.text(`Payslip ${index} of ${total}`, left, y + 6, { width, align: "right" });

  doc.font("Helvetica-Oblique").fontSize(7).fillColor("#888")
    .text("This is a computer-generated payslip and does not require a signature.", left, y + 16, { width, align: "left" });
}

/**
 * Every employee's payslip for one month, one per page.
 *
 * Renders from the frozen payroll lines rather than from current salaries,
 * so reprinting an old month shows what was actually paid then.
 */
export function renderPayslipsPdf(options: PayslipsPdfOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: {
        Title: `Payslips — ${periodLabel(options.periodYear, options.periodMonth)}`,
        Author: options.schoolName,
        // The date the payroll was run, not the date this copy was produced,
        // so a reprint does not claim to be a new document.
        CreationDate: options.generatedAt,
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      options.lines.forEach((line, index) => {
        if (index > 0) {
          doc.addPage();
        }

        drawHeader(doc, options);
        drawEmployeeBlock(doc, line);
        doc.y += 8;
        drawBreakdown(doc, computePay(payComponentsOf(line as unknown as Record<string, unknown>)));
        drawFooter(doc, options, index + 1, options.lines.length);
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

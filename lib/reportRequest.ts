import { scopeForDate, type ReportScope } from "./reports/scope";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseReportDate(searchParams: URLSearchParams): { date: string | null; error?: string } {
    const raw = searchParams.get("date");

    if (!raw || raw === "null" || raw === "all") {
        return { date: null };
    }

    if (!DATE_PATTERN.test(raw)) {
        return { date: null, error: "Invalid date. Expected format YYYY-MM-DD or 'all'." };
    }

    const [year, month, day] = raw.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    const roundTrips = parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
    if (!roundTrips) {
        return { date: null, error: "Invalid date. The date given does not exist." };
    }

    return { date: raw };
}

export function formatDateLabel(date: string | null): string {
    if (!date) return "All Dates";
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    });
}

export function isPdfFormat(searchParams: URLSearchParams): boolean {
    return searchParams.get("format") === "pdf";
}

/**
 * Reads a report's coverage from the query string. Understands three shapes,
 * in this order:
 *
 *   date=YYYY-MM-DD          a single day (what the reports started with)
 *   start=...&end=...        an inclusive range
 *   payment_period_id=N      the school's own billing period
 *
 * Absent, or date=all, means every date.
 */
export function parseReportScope(searchParams: URLSearchParams): { scope: ReportScope | null; error?: string } {
    const periodRaw = searchParams.get("payment_period_id");
    if (periodRaw && periodRaw !== "null") {
        const paymentPeriodId = Number(periodRaw);
        if (!Number.isInteger(paymentPeriodId) || paymentPeriodId <= 0) {
            return { scope: null, error: "Invalid payment_period_id." };
        }
        return { scope: { start: null, end: null, paymentPeriodId } };
    }

    const startRaw = searchParams.get("start");
    const endRaw = searchParams.get("end");
    if (startRaw || endRaw) {
        const start = readDate(startRaw);
        const end = readDate(endRaw);
        if (start.error) return { scope: null, error: `Invalid start date. ${start.error}` };
        if (end.error) return { scope: null, error: `Invalid end date. ${end.error}` };
        if (start.date && end.date && start.date > end.date) {
            return { scope: null, error: "The start date must not be after the end date." };
        }
        return { scope: { start: start.date, end: end.date, paymentPeriodId: null } };
    }

    const { date, error } = parseReportDate(searchParams);
    if (error) return { scope: null, error };
    return { scope: scopeForDate(date) };
}

function readDate(raw: string | null): { date: string | null; error?: string } {
    if (!raw || raw === "null" || raw === "all") return { date: null };
    if (!DATE_PATTERN.test(raw)) return { date: null, error: "Expected format YYYY-MM-DD." };
    const [year, month, day] = raw.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    const roundTrips = parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
    return roundTrips ? { date: raw } : { date: null, error: "The date given does not exist." };
}

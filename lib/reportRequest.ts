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

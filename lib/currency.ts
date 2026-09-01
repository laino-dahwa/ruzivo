// Canonical currency formatter for both the app UI and PDF reports.
export function formatCurrency(value: number | string, options?: { maximumFractionDigits?: number }): string {
    const numeric = typeof value === "string" ? Number(value) : value;
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: options?.maximumFractionDigits ?? 2,
    }).format(Number.isFinite(numeric) ? numeric : 0);
}

// Kept in sync with the money() formatter used across app/App.tsx so PDF
// reports show the same currency style as the live pages.
export function formatCurrency(value: number | string): string {
    const numeric = typeof value === "string" ? Number(value) : value;
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
    }).format(Number.isFinite(numeric) ? numeric : 0);
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{(error as Error).message}</p>;
}

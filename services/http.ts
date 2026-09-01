// Shared low-level fetch helpers for the /api client layer.

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = body?.error ?? message;
    } catch {
      // ignore parse failure, keep default message
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function errorMessageFor(response: Response) {
  let message = `Request failed (${response.status})`;
  try {
    const body = await response.json();
    message = body?.error ?? message;
  } catch {
    // ignore parse failure, keep default message
  }
  return message;
}

export function qs(params: Record<string, string | null | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => search.set(key, value && value.length > 0 ? value : 'null'));
  return search.toString();
}

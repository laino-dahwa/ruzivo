import type { ReactNode } from 'react';

/**
 * The frame shared by the sign-in, first-run setup and change-password
 * screens. These sit outside the (app) route group — there is no sidebar to
 * show someone who is not signed in, and no school to brand it with yet.
 */
export function AuthCard({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div className="grain flex min-h-[100dvh] items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-sidebar">
            {/* eslint-disable-next-line @next/next/no-img-element -- matches the sidebar brand, which is also a plain img */}
            <img src="/branding/logo/logo.png" alt="" className="h-full w-full object-contain" />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-foreground">{title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}

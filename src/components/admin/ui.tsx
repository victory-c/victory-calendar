import type { ReactNode } from 'react';

// Small shared pieces for admin screens (hand-written; see PROGRESS「待确认」on shadcn).

export function Screen({ title, sub, children, action }: { title: string; sub?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 pt-6 pb-8">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-h2 font-display font-semibold">{title}</h1>
          {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
        </div>
        {action}
      </header>
      {children}
    </main>
  );
}

export function Chip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'ai' | 'seal' }) {
  const cls = tone === 'ai' ? 'border-cat-ai text-cat-ai' : tone === 'seal' ? 'border-seal text-seal-text' : 'border-rule text-muted';
  return <span className={`inline-flex h-6 items-center rounded-full border px-2 font-mono text-[0.6875rem] uppercase ${cls}`}>{children}</span>;
}

export const btn = {
  primary: 'inline-flex h-11 items-center justify-center whitespace-nowrap rounded-full bg-ink px-4 text-sm text-paper disabled:opacity-50',
  secondary: 'inline-flex h-11 items-center justify-center whitespace-nowrap rounded-full border border-rule px-4 text-sm disabled:opacity-50',
  danger: 'inline-flex h-11 items-center justify-center whitespace-nowrap rounded-full border border-seal px-4 text-sm text-seal-text disabled:opacity-50',
  small: 'inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full border border-rule px-3 text-sm disabled:opacity-50',
};

export const field = {
  label: 'block text-sm text-muted',
  input: 'mt-1 block h-11 w-full rounded-lg border border-rule bg-paper px-3 text-base text-ink',
  area: 'mt-1 block w-full rounded-lg border border-rule bg-paper px-3 py-2 text-base text-ink',
};

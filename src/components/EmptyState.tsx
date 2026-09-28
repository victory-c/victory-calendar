import { Link } from '@/i18n/navigation';

export function EmptyState({ text, action }: { text: string; action?: { href: string; label: string } }) {
  return (
    <div className="relative my-12 overflow-hidden rounded-card border border-dashed border-rule px-6 py-12 text-center">
      <span aria-hidden className="pointer-events-none absolute -right-4 -bottom-6 grid size-28 rotate-[-3deg] place-items-center rounded-md bg-seal/10 font-display text-5xl text-seal/30">
        V
      </span>
      <p className="note relative mx-auto max-w-md text-lg">{text}</p>
      {action && (
        <Link href={action.href} className="relative mt-5 inline-flex h-11 items-center rounded-full border border-rule px-5 text-sm">
          {action.label}
        </Link>
      )}
    </div>
  );
}

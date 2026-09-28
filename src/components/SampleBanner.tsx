export function SampleBanner({ text }: { text: string }) {
  return (
    <p role="note" className="border-b border-rule bg-rule/40 px-4 py-2 text-center text-xs text-muted">
      {text}
    </p>
  );
}

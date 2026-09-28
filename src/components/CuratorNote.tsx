export function CuratorNote({ text, lang, signature, clamp = true }: { text: string; lang: 'en' | 'zh-Hans'; signature: string; clamp?: boolean }) {
  return (
    <blockquote className="border-l-2 border-seal pl-3">
      <p lang={lang} className={`note text-[0.9375rem] leading-snug ${clamp ? 'line-clamp-2' : ''}`}>
        {text}
      </p>
      <footer className="mt-0.5 font-mono text-xs text-muted">{signature}</footer>
    </blockquote>
  );
}

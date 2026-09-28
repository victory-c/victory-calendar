import { getTranslations } from 'next-intl/server';

export default async function Home() {
  const t = await getTranslations();
  return (
    <main id="main" className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-h1">{t('Site.name')}</h1>
      <p className="mt-2 max-w-prose text-muted">{t('Site.tagline')}</p>
      <h2 className="mt-10 text-h2">{t('Home.thisWeek')}</h2>
      <p className="mt-2 text-muted">{t('Home.comingSoon')}</p>
    </main>
  );
}

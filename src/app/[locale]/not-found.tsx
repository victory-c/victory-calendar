import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function NotFound() {
  const t = await getTranslations('NotFound');
  return (
    <main id="main" className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-h2">{t('title')}</h1>
      <Link href="/" className="mt-4 inline-block underline underline-offset-4">
        {t('back')}
      </Link>
    </main>
  );
}

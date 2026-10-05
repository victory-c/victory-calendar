import { subscriberLinks } from '../subscribers/links';
import { CATEGORIES, type Category, type Locale } from '../taxonomy';
import { sendEmail } from './send';

// Transactional subscription mail (guide「确认邮件」): bilingual, no promotion, same From address
// as the digest. The subscriber's language comes first. Plain HTML like the magic-link email;
// react-email arrives with the digest template in week 14.

type Sub = { id: string; email: string; tokenVersion: number; locale: Locale; categories: string[] };

/** Subject in the subscriber's language first, then the other, then the sender name. */
const subject = (sub: Sub, en: string, zh: string) => (sub.locale === 'zh' ? `${zh} · ${en}` : `${en} · ${zh}`) + " · Victor's Picks";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const labels = (cats: string[], l: Locale) =>
  cats.filter((c): c is Category => c in CATEGORIES).map((c) => CATEGORIES[c][l]).join(l === 'zh' ? '、' : ', ');

type Block = { lead: string; button: string; after: string[] };

function render(sub: Sub, url: string, blocks: Record<Locale, Block>) {
  const order: Locale[] = sub.locale === 'zh' ? ['zh', 'en'] : ['en', 'zh'];
  const text = order
    .flatMap((l) => [blocks[l].lead, url, ...blocks[l].after, ''])
    .join('\n')
    .trim();
  const section = (l: Locale) => `<div lang="${l === 'zh' ? 'zh-Hans' : 'en'}" style="margin:0 0 24px">
<p style="margin:0 0 12px">${esc(blocks[l].lead)}</p>
<p style="margin:0 0 12px"><a href="${esc(url)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#1a1a1a;color:#fafaf7;text-decoration:none">${esc(blocks[l].button)}</a></p>
${blocks[l].after.map((p) => `<p style="margin:0 0 8px;color:#6b7280;font-size:14px">${esc(p)}</p>`).join('\n')}
</div>`;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;max-width:560px">
${order.map(section).join('\n<hr style="border:none;border-top:1px solid #e5e5e0;margin:0 0 24px">\n')}
<p style="color:#6b7280;font-size:12px;word-break:break-all">${esc(url)}</p>
</div>`;
  return { html, text };
}

/** Double opt-in: nothing is sent to this address again until the link is clicked. */
export async function sendConfirmEmail(sub: Sub) {
  const url = subscriberLinks(sub).confirm;
  const { html, text } = render(sub, url, {
    en: {
      lead: "Confirm that you want Victor's Picks by email: one email on Sunday evening with the categories you picked.",
      button: 'Confirm subscription',
      after: [`You picked: ${labels(sub.categories, 'en')}.`, "If this wasn't you, ignore this email: nothing is sent until the link is clicked, and the request expires in 7 days."],
    },
    zh: {
      lead: '请确认订阅 Victor 精选周报：每周日晚上一封，只有你选的类别。',
      button: '确认订阅',
      after: [`你选了：${labels(sub.categories, 'zh')}。`, '如果不是你本人操作，忽略即可：不点链接就不会收到任何周报，这个申请 7 天后失效。'],
    },
  });
  return sendEmail({ to: sub.email, subject: subject(sub, 'Confirm your subscription', '确认订阅'), html, text });
}

/** Someone (maybe them) asked again for an address that is already subscribed: send the prefs link, change nothing. */
export async function sendAlreadySubscribedEmail(sub: Sub) {
  const url = subscriberLinks(sub).prefs;
  const { html, text } = render(sub, url, {
    en: {
      lead: "This address is already subscribed to Victor's Picks. Nothing changed. To change categories, language or pause the emails:",
      button: 'Manage subscription',
      after: ["If you didn't ask for this, ignore it."],
    },
    zh: {
      lead: '这个邮箱已经订阅了 Victor 精选，没有任何改动。要改类别、语言或暂停：',
      button: '管理订阅',
      after: ['如果不是你本人操作，忽略即可。'],
    },
  });
  return sendEmail({ to: sub.email, subject: subject(sub, "You're already subscribed", '已经订阅过了'), html, text });
}

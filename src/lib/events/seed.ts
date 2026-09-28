// 20 sample events for design review before the database and ingest exist. Dates are
// relative to "today" in Pacific time so the preview always has a current week. Every page
// that renders these shows a "sample data · 示例数据" banner; hosts are fictional.
import { TZDate } from '@date-fns/tz';
import { dayKey, PT } from '../format/date';
import type { Category } from '../taxonomy';
import type { GoingStatus, GoingVisibility, PublicEvent } from './types';

type Seed = {
  slug: string;
  day: number; // offset from today (PT)
  start: string; // HH:MM PT
  hours: number;
  category: Category;
  titleEn: string;
  titleZh?: string; // omitted = official name kept in English
  noteEn?: string;
  noteZh?: string;
  summaryEn?: string;
  summaryZh?: string;
  eventLanguage?: PublicEvent['eventLanguage'];
  format?: PublicEvent['format'];
  venueName?: string;
  city: string;
  region: NonNullable<PublicEvent['region']>;
  priceText?: string;
  access?: PublicEvent['access'];
  hostName: string;
  sourceUrl?: string;
  going?: GoingStatus;
  goingVisibility?: GoingVisibility;
  privateVenue?: boolean;
  featured?: boolean;
  cancelled?: boolean;
  allDay?: boolean;
};

const SEEDS: Seed[] = [
  {
    slug: 'agents-evals-night', day: 0, start: '18:30', hours: 2.5, category: 'ai',
    titleEn: 'Agents & Evals Night', titleZh: 'Agents & Evals Night',
    noteZh: '六个 5 分钟 demo，全讲评测不讲愿景。适合已经在做 agent、卡在“怎么知道它变好了”的人。',
    noteEn: 'Six five-minute demos, all about evals, none about vision. Go if your agent works and you can’t tell whether it got better.',
    venueName: 'SoMa loft', city: 'San Francisco', region: 'sf', priceText: 'Free', access: 'apply',
    hostName: 'Bay Builders Collective', going: 'going', featured: true,
  },
  {
    slug: 'berkeley-founders-breakfast', day: 1, start: '08:00', hours: 1.5, category: 'campus',
    titleEn: 'Berkeley Founders Breakfast', titleZh: '伯克利创始人早餐会',
    noteEn: 'Small table, real questions. Best early-morning room on campus for first-time founders.',
    noteZh: '小桌子，真问题。校园里给第一次创业的人最好的早场。',
    venueName: 'Downtown Berkeley co-working', city: 'Berkeley', region: 'east_bay', priceText: 'Free', access: 'open',
    hostName: 'Cal Venture Circle', going: 'interested',
  },
  {
    slug: 'gpu-kernels-workshop', day: 1, start: '17:30', hours: 3, category: 'ai',
    titleEn: 'Hands-on: Writing Your First GPU Kernel', titleZh: '动手写第一个 GPU kernel',
    noteZh: '带电脑。讲者会从 CUDA 一路讲到 Triton，节奏快但有助教。',
    noteEn: 'Bring a laptop. CUDA to Triton in one evening, fast but there are TAs.',
    venueName: 'Mission Bay studio', city: 'San Francisco', region: 'sf', priceText: '$20', access: 'waitlist',
    hostName: 'Kernel Club SF', going: 'interested', eventLanguage: 'en',
  },
  {
    slug: 'chinese-founders-mixer', day: 2, start: '19:00', hours: 2.5, category: 'social',
    titleEn: 'Chinese Founders Mixer', titleZh: '湾区华人创业者交流夜',
    noteZh: '中文为主，气氛轻松。第一次来湾区、想认识做 AI 的华人朋友，这场最友好。',
    noteEn: 'Mostly in Mandarin, relaxed. The friendliest room if you just moved here and build in AI.',
    eventLanguage: 'zh', venueName: 'Palo Alto café', city: 'Palo Alto', region: 'peninsula', priceText: '$15', access: 'open',
    hostName: 'Bridge Builders 湾区', going: 'going', featured: true,
  },
  {
    slug: 'seed-fundraising-fireside', day: 2, start: '18:00', hours: 1.5, category: 'vc',
    titleEn: 'Fireside: Raising a Seed Round in 2026', titleZh: '炉边谈话：2026 年怎么融种子轮',
    noteEn: 'Two partners, one founder who just closed. Ask about SAFEs vs. priced rounds.',
    noteZh: '两位合伙人加一位刚交割的创始人。可以问 SAFE 和定价轮怎么选。',
    venueName: 'Financial District office', city: 'San Francisco', region: 'sf', priceText: 'Free', access: 'apply',
    hostName: 'Pier 70 Ventures', going: 'speaking',
  },
  {
    slug: 'weekend-agent-hackathon', day: 4, start: '09:00', hours: 34, category: 'hackathon',
    titleEn: 'Weekend Agent Hackathon', titleZh: '周末 Agent 黑客松',
    noteZh: '36 小时，组队或单人都行。奖项不大，但评委是真在招人的团队。',
    noteEn: '36 hours, solo or team. Small prizes, but the judges are teams actually hiring.',
    venueName: 'SoMa event hall', city: 'San Francisco', region: 'sf', priceText: 'Free', access: 'apply',
    hostName: 'Open Source Weekend', going: 'going', featured: true,
  },
  {
    slug: 'east-bay-gran-fondo', day: 5, start: '07:30', hours: 6, category: 'cycling',
    titleEn: 'East Bay Hills Gran Fondo', titleZh: '东湾山地 Gran Fondo',
    noteZh: '100 公里，爬升 1,600 米，有补给站。报名制的正式活动。',
    noteEn: '100 km with 1,600 m of climbing and aid stations. A registered event.',
    venueName: 'Tilden start line', city: 'Berkeley', region: 'east_bay', priceText: '$85', access: 'open',
    hostName: 'Diablo Cycling Club', going: 'going',
  },
  {
    slug: 'founders-coffee-rave', day: 5, start: '10:00', hours: 3, category: 'social',
    titleEn: 'Founders Coffee Rave', titleZh: 'Founders Coffee Rave',
    noteEn: 'Espresso and a DJ at 10 a.m. Weirdly good for meeting people without drinking.',
    noteZh: '早上十点的浓缩咖啡加 DJ。不喝酒也能认识人，意外地好用。',
    venueName: 'Hayes Valley', city: 'San Francisco', region: 'sf', priceText: '$10', access: 'open',
    hostName: 'Morning Signal', going: 'interested', sourceUrl: 'https://partiful.com/',
  },
  {
    slug: 'rag-to-riches-talk', day: 3, start: '12:00', hours: 1, category: 'ai',
    titleEn: 'Retrieval Is Still Hard: A Postmortem', titleZh: '检索依然很难：一次复盘',
    noteEn: 'Online at lunch. An honest writeup of a retrieval system that failed in production.',
    noteZh: '午饭时间的线上分享，老实讲一个在生产环境翻车的检索系统。',
    format: 'online', city: 'Online', region: 'online', priceText: 'Free', access: 'open',
    hostName: 'Latency Club', going: 'interested',
  },
  {
    slug: 'scet-demo-day', day: 3, start: '16:00', hours: 3, category: 'campus',
    titleEn: 'Student Startup Demo Day', titleZh: '学生创业 Demo Day',
    noteZh: '十支学生团队路演，投资人会留下来聊。想找早期项目的人值得来。',
    noteEn: 'Ten student teams pitch and investors stay to talk. Worth it if you scout very early.',
    venueName: 'Sutardja Dai Hall', city: 'Berkeley', region: 'east_bay', priceText: 'Free', access: 'open',
    hostName: 'Campus Launch Lab', going: 'hosting',
  },
  {
    slug: 'pitch-night-hardware', day: 6, start: '18:30', hours: 2, category: 'vc',
    titleEn: 'Hardware Pitch Night', titleZh: '硬件项目路演之夜',
    noteEn: 'Robotics and climate hardware only. Rare room where the VCs actually know supply chains.',
    noteZh: '只收机器人和气候硬件。少见的、投资人真懂供应链的场子。',
    venueName: 'Dogpatch workshop', city: 'San Francisco', region: 'sf', priceText: '$25', access: 'apply',
    hostName: 'Atoms Capital', going: 'going', privateVenue: true,
  },
  {
    slug: 'bilingual-ai-salon', day: 6, start: '14:00', hours: 2.5, category: 'ai',
    titleEn: 'Bilingual AI Research Salon', titleZh: '中英双语 AI 研究沙龙',
    noteZh: '两篇论文精读，中英文都可以提问。研究生和工程师各占一半。',
    noteEn: 'Two papers, close reading, questions in either language. Half grad students, half engineers.',
    eventLanguage: 'bilingual', venueName: 'Cupertino library room', city: 'Cupertino', region: 'south_bay', priceText: 'Free', access: 'open',
    hostName: '湾区读论文小组', going: 'interested',
  },
  {
    slug: 'tech-week-opening', day: 7, start: '17:00', hours: 4, category: 'conference',
    titleEn: 'Tech Week Opening Night', titleZh: 'Tech Week 开幕夜',
    noteEn: 'The busiest night of the week. Go for the first hour, then leave for the side events.',
    noteZh: '一周里最挤的一晚。前一小时去看看，然后转场去周边活动。',
    venueName: 'Embarcadero pavilion', city: 'San Francisco', region: 'sf', priceText: '$49', access: 'open',
    hostName: 'Tech Week Collective', sourceUrl: 'https://www.eventbrite.com/', going: 'interested', featured: false,
  },
  {
    slug: 'applied-ml-summit', day: 8, start: '09:00', hours: 8, category: 'conference',
    titleEn: 'Applied ML Summit', titleZh: 'Applied ML Summit',
    noteZh: '一整天的大会，下午的 infra 分会场最值。学生票打五折。',
    noteEn: 'Full-day conference; the afternoon infra track is the reason to go. Students get 50% off.',
    venueName: 'Moscone West', city: 'San Francisco', region: 'sf', priceText: '$199 · students $99', access: 'open',
    hostName: 'Applied ML Society', going: 'interested',
  },
  {
    slug: 'build-in-public-happy-hour', day: 8, start: '18:00', hours: 2, category: 'social',
    titleEn: 'Build in Public Happy Hour', titleZh: 'Build in Public Happy Hour',
    noteEn: 'Cancelled by the host — keeping it here so nobody shows up to a locked door.',
    noteZh: '主办方已取消，留在这里是为了不让大家白跑。',
    venueName: 'Mission bar', city: 'San Francisco', region: 'sf', priceText: 'Free', access: 'open',
    hostName: 'Indie Makers SF', cancelled: true, going: 'interested',
  },
  {
    slug: 'climate-hack-weekend', day: 11, start: '10:00', hours: 30, category: 'hackathon',
    titleEn: 'Climate Data Hack Weekend', titleZh: '气候数据黑客松',
    noteZh: '题目来自三个真实的市政数据集。适合想做点有用的事的周末。',
    noteEn: 'Problems come from three real city datasets. A weekend for building something useful.',
    venueName: 'Oakland maker space', city: 'Oakland', region: 'east_bay', priceText: 'Free', access: 'apply',
    hostName: 'Civic Data Guild', going: 'interested',
  },
  {
    slug: 'investor-office-hours', day: 9, start: '15:00', hours: 3, category: 'vc',
    titleEn: 'Investor Office Hours for Student Founders', titleZh: '学生创始人投资人答疑',
    noteEn: '15-minute slots, sign up early. Bring a one-pager, not a deck.',
    noteZh: '每人 15 分钟，早点报名。带一页纸，不要带 deck。',
    venueName: 'Berkeley SkyDeck', city: 'Berkeley', region: 'east_bay', priceText: 'Free', access: 'apply',
    hostName: 'Golden Bear Angels', going: 'going',
  },
  {
    slug: 'robotics-meetup', day: 10, start: '18:30', hours: 2.5, category: 'ai',
    titleEn: 'Robot Learning Meetup', titleZh: '机器人学习 Meetup',
    noteZh: '三场 lightning talk 加现场机械臂 demo。第一次去也能听懂。',
    noteEn: 'Three lightning talks and a live arm demo. Accessible on your first visit.',
    venueName: 'Mountain View lab', city: 'Mountain View', region: 'peninsula', priceText: 'Free', access: 'waitlist',
    hostName: 'Actuated', sourceUrl: 'https://www.meetup.com/', going: 'interested',
  },
  {
    slug: 'fellowship-info-session', day: 12, start: '17:00', hours: 1, category: 'campus',
    titleEn: 'Founder Fellowship Info Session', titleZh: '创始人 Fellowship 宣讲会',
    noteEn: 'Online. Worth 45 minutes if you are graduating in spring and considering building.',
    noteZh: '线上。春季毕业、在考虑创业的同学值得花 45 分钟。',
    format: 'online', city: 'Online', region: 'online', priceText: 'Free', access: 'open',
    hostName: 'Next Chapter Fellowship', going: 'interested',
  },
  {
    slug: 'moon-festival-picnic', day: 13, start: '12:00', hours: 4, category: 'social',
    titleEn: 'Mid-Autumn Tech Picnic', titleZh: '中秋科技人野餐',
    noteZh: '带月饼换月饼。湾区华人科技圈一年里最放松的一场。',
    noteEn: 'Bring mooncakes to trade. The most relaxed day of the year for the Chinese tech crowd.',
    eventLanguage: 'zh', venueName: 'Golden Gate Park', city: 'San Francisco', region: 'sf', priceText: 'Free', access: 'open',
    hostName: '湾区科技人', going: 'going', allDay: false,
  },
];

function atPT(dayOffset: number, hhmm: string, now: Date) {
  const [y, m, d] = dayKey(now, PT).split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(new TZDate(y, m - 1, d + dayOffset, hh, mm, 0, PT).getTime());
}

export function seedEvents(now = new Date()): PublicEvent[] {
  return SEEDS.map((s, i) => {
    const startAt = atPT(s.day, s.start, now);
    return {
      id: `seed_${String(i + 1).padStart(2, '0')}`,
      slug: s.slug,
      status: s.cancelled ? 'cancelled' : 'published',
      titleEn: s.titleEn,
      titleZh: s.titleZh ?? s.titleEn,
      summaryEn: s.summaryEn ?? null,
      summaryZh: s.summaryZh ?? null,
      noteEn: s.noteEn ?? null,
      noteZh: s.noteZh ?? null,
      category: s.category,
      tags: [],
      eventLanguage: s.eventLanguage ?? 'en',
      startAt,
      endAt: new Date(startAt.getTime() + s.hours * 3600_000),
      tz: PT,
      allDay: s.allDay ?? false,
      format: s.format ?? 'in_person',
      venueName: s.venueName ?? null,
      city: s.city,
      neighborhood: null,
      region: s.region,
      address: null,
      privateVenue: s.privateVenue ?? false,
      priceText: s.priceText ?? null,
      access: s.access ?? 'unknown',
      hostName: s.hostName,
      hostUrl: null,
      sourceUrl: s.sourceUrl ?? 'https://luma.com/sf',
      going: s.going ?? 'interested',
      goingVisibility: s.goingVisibility ?? 'public',
      featured: s.featured ?? false,
      sequence: 0,
      cover: null, // template tile
      sample: true,
    };
  });
}

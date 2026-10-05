import { initBotId } from 'botid/client/core';

// BotID (guide「订阅防滥用」): patches fetch so the subscribe Server Action's POST carries the
// challenge headers that checkBotId() verifies. An action posts to the page that renders it, so
// these are page paths, and only those two: a wider pattern would hold every other POST (admin
// actions included) until the challenge script loads. Synchronous, so it is done before hydration.
try {
  initBotId({
    protect: [
      { path: '/subscribe', method: 'POST' },
      { path: '/zh/subscribe', method: 'POST' },
    ],
  });
} catch (err) {
  // Never break the page over this; the action then answers with the "couldn't verify" error.
  console.error('[botid] init failed', err);
}

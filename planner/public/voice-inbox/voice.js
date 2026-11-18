// Voice Inbox page: the planner's Voice Inbox as a page of its own (good as a phone home-screen
// app). The capture box and the feed are the shared component (../js/inbox.js), also shown in the
// planner's side panel.
import { store } from '../js/store.js';
import { toast } from '../js/ui.js';
import { mountVoice } from '../js/inbox.js';

const $ = (id) => document.getElementById(id);

await store.load();
const theme = () => {
  const light = store.state.settings.theme === 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]').content = light ? '#f6f5f2' : '#0b0b0c';
};
theme();
store.subscribe(theme);
const voice = mountVoice($('vi-main'), { onStatus: (t) => ($('vi-sub').textContent = t) });
// /planner/voice-inbox#dictate (the home-screen shortcut) starts listening straight away.
if (location.hash === '#dictate') voice.dictate();

const dot = $('vi-dot');
document.addEventListener('planner:saved', (e) => {
  dot.className = `vi-dot ${e.detail.ok ? 'ok' : 'err'}`;
  dot.title = e.detail.ok ? 'Saved' : 'Saved in this browser only (server unreachable)';
});
$('vi-sync').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.classList.add('spin');
  if (store.dirty) await store.flush();
  await store.pull();
  setTimeout(() => b.classList.remove('spin'), 600);
  toast('Up to date', { ms: 1200 });
});
addEventListener('beforeunload', () => store.flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });

// Morning Briefs page: the reader on a page of its own. The reader itself is the shared component
// (../js/inbox.js), also shown as the Brief tab of the planner's side panel.
import { store } from '../js/store.js';
import { toast } from '../js/ui.js';
import { mountBriefs, markBriefSeen } from '../js/inbox.js';

const $ = (id) => document.getElementById(id);

await store.load();
const theme = () => {
  const light = store.state.settings.theme === 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]').content = light ? '#f6f5f2' : '#0b0b0c';
};
theme();
store.subscribe(theme);
mountBriefs($('br-main'), { onStatus: (t) => ($('vi-sub').textContent = t) });
markBriefSeen();

const dot = $('vi-dot');
document.addEventListener('planner:saved', (e) => { dot.className = `vi-dot ${e.detail.ok ? 'ok' : 'err'}`; });
$('vi-sync').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.classList.add('spin');
  await store.pull();
  setTimeout(() => b.classList.remove('spin'), 600);
  toast('Up to date', { ms: 1200 });
});

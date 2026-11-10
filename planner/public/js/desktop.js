// Mac app only (loaded by app.js when window.plannerDesktop exists): the planner window's title
// bar, its name in the top bar, and the brand opening the planner library.
const bridge = window.plannerDesktop;

document.documentElement.dataset.desktop = '';
document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/pages/desktop.css' }));

const brand = document.querySelector('.brand');
const name = Object.assign(document.createElement('span'), { className: 'planner-name' });
brand.append(name);
brand.title = 'All planners (⌘O)';
brand.addEventListener('click', (e) => {
  e.preventDefault();
  bridge.openLibrary();
});

const info = await bridge.info();
const show = (n) => {
  name.textContent = n;
  document.title = `${n} — Planner`;
};
if (info) show(info.name);
bridge.onRenamed((id, n) => id === info?.id && show(n));

// The planner library window follows the theme you use.
const remember = () => {
  try { localStorage.setItem('planner.lib.theme', document.documentElement.dataset.theme || 'dark'); } catch {}
};
new MutationObserver(remember).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
remember();

// ---------- Settings › Sync with website ----------
// One element kept across Settings re-renders (so a half-typed password survives a redraw).
const { h, fill, toast } = await import('./ui.js');
const panel = h('div.sync-panel');
let st = null;
let busy = false;

const ago = (t) => {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleString();
};
const host = (site) => {
  try { return new URL(site).host; } catch { return site; }
};

async function act(fn, ok) {
  if (busy) return;
  busy = true;
  draw();
  try {
    st = await fn();
    if (st?.lastError) toast(st.lastError, { kind: 'warn' });
    else if (ok) toast(ok);
  } catch (e) {
    toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { kind: 'warn' });
  }
  busy = false;
  draw();
}

function draw() {
  if (!st) return fill(panel, h('h3', 'Sync with website'), h('p.help', 'Loading…'));
  const here = info?.id && st.planner === info.id;
  if (!st.connected) {
    const site = h('input.input', { value: st.site || 'https://www.haozhewang.com', placeholder: 'https://www.haozhewang.com', autocomplete: 'off', spellcheck: false });
    const pw = h('input.input', { type: 'password', placeholder: 'Planner password', autocomplete: 'current-password' });
    const go = () => act(() => bridge.sync.connect(site.value.trim(), pw.value), 'Connected. This planner now syncs with the website.');
    pw.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    return fill(panel,
      h('h3', 'Sync with website'),
      h('p.help', 'Keeps this planner and your private planner on the website in sync, merging changes from both (your phone included). Your password is used once to connect this Mac and is not saved.'),
      st.lastError ? h('p.help.warn', st.lastError) : null,
      h('div.field', h('label', 'Website'), site),
      h('div.field', h('label', 'Password'), pw),
      h('button.btn.primary.small', { disabled: busy, onclick: go }, busy ? 'Connecting…' : 'Connect'));
  }
  return fill(panel,
    h('h3', 'Sync with website'),
    h('p.sync-line',
      h(`span.sync-dot${st.lastError ? '.err' : st.syncing || busy ? '.busy' : '.ok'}`),
      st.lastError ? `Couldn’t sync: ${st.lastError}` : st.syncing || busy ? 'Syncing…' : `Synced ${ago(st.lastSync)} with ${host(st.site)}`),
    here
      ? h('p.help', 'This planner syncs automatically: when Planner opens, every few minutes, and shortly after you change something.')
      : h('div',
        h('p.help', st.plannerName ? `“${st.plannerName}” is the planner that syncs with the website.` : 'No planner is syncing right now.'),
        h('button.btn.small', { disabled: busy, onclick: () => act(() => bridge.sync.linkThis(), 'This planner now syncs with the website.') }, 'Sync this planner instead')),
    h('div.inline', { style: { gap: '6px', flexWrap: 'wrap', margin: '8px 0' } },
      h('button.btn.small', { disabled: busy || !here, onclick: () => act(() => bridge.sync.now()) }, 'Sync now'),
      h('button.btn.small.ghost', { disabled: busy, onclick: () => act(() => bridge.sync.disconnect(), 'Disconnected from the website.') }, 'Disconnect')),
    h('label.cal-pick', h('input', { type: 'checkbox', checked: st.daily, onchange: (e) => act(() => bridge.sync.setDaily(e.target.checked)) }), 'Also sync every morning when Planner is closed'),
  );
}

bridge.sync.onStatus((next) => {
  st = next;
  draw();
});
st = await bridge.sync.status();
draw();
setInterval(draw, 60000); // "synced 3 min ago" stays current
window.plannerSyncPanel = () => panel;

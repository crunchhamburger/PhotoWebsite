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

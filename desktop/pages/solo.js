// One list in its own window: the same list card as on the board (check off, add, edit, reorder,
// details, focus timer), kept in sync with the planner's other windows.
import { store, findCard } from '../js/store.js';
import { initBoard, render, SOLO } from '../js/board.js';
import { toast } from '../js/ui.js';

const bridge = window.plannerDesktop;
const gone = document.getElementById('solo-gone');
const pin = document.getElementById('solo-pin');

await store.load();
const applyTheme = () => (document.documentElement.dataset.theme = store.state.settings.theme === 'light' ? 'light' : 'dark');
applyTheme();

function update() {
  const card = findCard(store.state, SOLO);
  gone.hidden = !!card;
  document.title = card ? card.title || 'List' : 'List';
}
initBoard();
update();

let frame = 0;
store.subscribe(() => {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
    update();
    applyTheme();
  });
});

addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const typing = e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (mod && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    const ok = e.shiftKey ? store.redoLast() : store.undoLast();
    if (!ok) toast(e.shiftKey ? 'Nothing to redo' : 'Nothing to undo', { ms: 1500 });
  }
  // N: jump to "add item".
  if (!mod && !typing && (e.key === 'n' || e.key === 'N')) {
    e.preventDefault();
    document.querySelector('.add-item')?.focus();
  }
});

async function showPin() {
  const on = await bridge.listPinned();
  pin.setAttribute('aria-pressed', String(on));
  pin.classList.toggle('on', on);
  pin.title = on ? 'Kept on top (click to let other windows cover it)' : 'Keep on top';
}
pin.addEventListener('click', async () => {
  await bridge.setListPinned(pin.getAttribute('aria-pressed') !== 'true');
  showPin();
});
showPin();
document.getElementById('solo-board').addEventListener('click', () => bridge.openBoard());
document.getElementById('solo-close').addEventListener('click', () => close());

addEventListener('beforeunload', () => store.flush());

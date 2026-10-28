// The desktop pet: the planner's pet engine on a transparent, screen-sized board.
// The window lets clicks through to the apps below except where they'd land on the pet itself
// (or on its ball, treats, menus), so it never gets in the way.
import { store, allItems } from '../js/store.js';
import { initBoard } from '../js/board.js';
import { initPets, syncPet, dropIn } from '../js/pets.js';
import { closeFloats } from '../js/ui.js';

const bridge = window.plannerDesktop;
const board = document.getElementById('board');
const world = document.getElementById('world');
const layer = document.getElementById('pets');
const pop = document.getElementById('popover');
const menuEl = document.getElementById('menu');

await store.load();
initBoard();
initPets();

// Settings changed in the planner window (pet kind, size, back to the board...).
let petKey = JSON.stringify(store.state.settings.pet || {});
// Tasks finished in the planner's other windows make the pet cheer here too. (Ones it finishes
// itself, by eating a dropped task, already cheer.)
let done = new Set(allItems(store.state).filter((x) => x.item.done).map((x) => x.item.id));
let remote = false;
const pull = store.pull.bind(store);
store.pull = async () => {
  remote = true;
  try { await pull(); } finally { remote = false; }
};
store.subscribe((s) => {
  const k = JSON.stringify(s.settings.pet || {});
  if (k !== petKey) syncPet();
  petKey = k;
  const now = new Set(allItems(s).filter((x) => x.item.done).map((x) => x.item.id));
  if (remote) for (const id of now) if (!done.has(id)) document.dispatchEvent(new CustomEvent('planner:done', { detail: { id } }));
  done = now;
});

// ---------- Click-through ----------

let overOther = false;
let interactive = false;
const background = new Set([document.documentElement, document.body, board, world, layer]);

/** Things on the overlay you can click: the ball, treats, bubbles with buttons... (not the empty screen). */
function clickable(el) {
  if (!el || background.has(el)) return false;
  if (el.closest('.pet3d')) return false; // the pet's canvas box: only its actual shape counts (pet-hover)
  return true;
}

function sync() {
  const want = board.classList.contains('pet-hover') || board.classList.contains('pet-grab') || !pop.hidden || !menuEl.hidden || overOther;
  if (want === interactive) return;
  interactive = want;
  bridge.petInteractive(want);
}

addEventListener('pointermove', (e) => {
  overOther = clickable(document.elementFromPoint(e.clientX, e.clientY));
  sync();
}, true);
new MutationObserver(sync).observe(board, { attributes: true, attributeFilter: ['class'] });
new MutationObserver(sync).observe(pop, { attributes: true, attributeFilter: ['hidden'] });
new MutationObserver(sync).observe(menuEl, { attributes: true, attributeFilter: ['hidden'] });

// Clicking another app closes the pet's menus (the click itself went to that app).
bridge.onPetBlur(() => closeFloats());
// Moved to the screen the mouse is on.
bridge.onPetScreen(() => setTimeout(dropIn, 60));

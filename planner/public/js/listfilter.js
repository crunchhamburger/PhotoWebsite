// A queue list's status filter: this device only (localStorage), never part of the board.
const KEY = 'planner.listFilter.v1';
let filters = {};
try { filters = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}

export const getListFilter = (listId) => filters[listId] || {};
export const allListFilters = () => filters;

export function setListFilter(listId, key, value) {
  const f = { ...(filters[listId] || {}) };
  if (value) f[key] = value;
  else delete f[key];
  if (Object.keys(f).length) filters[listId] = f;
  else delete filters[listId];
  try { localStorage.setItem(KEY, JSON.stringify(filters)); } catch {}
}

export function clearListFilter(listId) {
  delete filters[listId];
  try { localStorage.setItem(KEY, JSON.stringify(filters)); } catch {}
}

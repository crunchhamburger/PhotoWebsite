// Card fields: a list can be a "queue" whose tasks carry structured fields (a status chip, short
// and long text, a link, numbers, a checkbox, a date) besides the usual due date and priority.
//
// A queue list stores its field definitions on the card (`list.fields`, copied from a preset), so
// the board JSON describes itself and any device or script can read it without this file. Each
// task keeps its values in `item.fields` ({ key: value }). Lists without `fields` are untouched.
// No DOM here, so it can be tested in Node.

/** Field definition: { key, label, type: 'select'|'text'|'url'|'number'|'checkbox'|'date', options?, colors?, long?, min?, max?, chip? } */

const STATUS_COLORS = { Draft: 'gray', Ready: 'blue', Running: 'yellow', Done: 'green', Partial: 'orange', Blocked: 'red' };

export const FIELD_PRESETS = {
  'night-queue': {
    name: 'Night Queue',
    fields: [
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Ready', 'Running', 'Done', 'Partial', 'Blocked'], colors: STATUS_COLORS, chip: true, filter: true },
      { key: 'exploration', label: 'Exploration', type: 'select', options: ['Higgsfield', 'Voice', 'Speaking', 'CRWV', 'Gamma', 'Night Shift', 'Recruiting'], chip: true },
      { key: 'goal', label: 'Goal', type: 'text', long: true },
      { key: 'inputs', label: 'Inputs', type: 'text', long: true },
      { key: 'doneWhen', label: 'Done when', type: 'text', long: true },
      { key: 'notAllowed', label: 'Not allowed', type: 'text', long: true },
      { key: 'output', label: 'Output location', type: 'text' },
      { key: 'budget', label: 'Budget', type: 'text' },
      { key: 'result', label: 'Result', type: 'url' },
      { key: 'score', label: 'Score', type: 'number', min: 0, max: 3, step: 1 },
      { key: 'reviewMinutes', label: 'Review minutes', type: 'number', min: 0, step: 1 },
      { key: 'stuck', label: 'Got stuck?', type: 'checkbox' },
      { key: 'notes', label: 'Notes', type: 'text', long: true },
    ],
  },
  'exploration-log': {
    name: 'Exploration Log',
    fields: [
      { key: 'question', label: 'Question', type: 'text', long: true },
      { key: 'experiment', label: 'Experiment', type: 'text', long: true },
      { key: 'finding', label: 'Finding', type: 'text', long: true },
      { key: 'opportunity', label: 'New opportunity', type: 'text', long: true },
      { key: 'decision', label: 'Decision', type: 'select', options: ['Continue', 'Change direction', 'Park'], colors: { Continue: 'green', 'Change direction': 'orange', Park: 'gray' }, chip: true, filter: true },
      { key: 'date', label: 'Date', type: 'date', chip: true },
    ],
  },
};

/** The field definitions of a list, or [] for an ordinary list. */
export const fieldsOf = (list) => (Array.isArray(list?.fields) ? list.fields.filter((f) => f && typeof f.key === 'string' && f.key) : []);
export const isQueue = (list) => fieldsOf(list).length > 0;

/** Gives a list a preset's fields (a copy, so later edits to the preset don't change old boards). Task values are kept. */
export function applyPreset(list, presetId) {
  const p = FIELD_PRESETS[presetId];
  if (!p) throw new Error(`unknown field preset: ${presetId}`);
  list.fields = structuredClone(p.fields);
  list.preset = presetId;
  return list;
}

/** Removes the field definitions from a list. Values stay on the tasks, so this is reversible. */
export function clearFields(list) {
  delete list.fields;
  delete list.preset;
  return list;
}

/** A task's value for a field, or undefined. */
export const getField = (item, key) => (item?.fields && typeof item.fields === 'object' ? item.fields[key] : undefined);

/**
 * Turns user or script input into a stored value for a field (null clears it). Numbers are clamped
 * to min/max, selects must be one of the options, checkboxes become booleans, urls must be http(s).
 * Returns { ok, value, error }.
 */
export function coerce(def, raw) {
  if (raw == null || raw === '') return { ok: true, value: null };
  switch (def.type) {
    case 'select': {
      const v = String(raw).trim();
      const hit = (def.options || []).find((o) => o.toLowerCase() === v.toLowerCase());
      return hit ? { ok: true, value: hit } : { ok: false, error: `${def.label} must be one of: ${(def.options || []).join(', ')}` };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return { ok: false, error: `${def.label} must be a number` };
      if (def.min != null && n < def.min) return { ok: false, error: `${def.label} must be at least ${def.min}` };
      if (def.max != null && n > def.max) return { ok: false, error: `${def.label} must be at most ${def.max}` };
      return { ok: true, value: n };
    }
    case 'checkbox': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      const s = String(raw).trim().toLowerCase();
      if (['true', 'yes', 'on', '1', 'x'].includes(s)) return { ok: true, value: true };
      if (['false', 'no', 'off', '0', ''].includes(s)) return { ok: true, value: false };
      return { ok: false, error: `${def.label} must be yes or no` };
    }
    case 'url': {
      const s = String(raw).trim();
      try {
        const u = new URL(s);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw 0;
      } catch {
        return { ok: false, error: `${def.label} must be an http(s) link` };
      }
      return { ok: true, value: s };
    }
    case 'date': {
      const s = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return { ok: false, error: `${def.label} must be YYYY-MM-DD` };
      return { ok: true, value: s };
    }
    default:
      return { ok: true, value: String(raw) };
  }
}

/** Sets one field on a task after coercion. Returns the coerce result; the task is only changed when ok. */
export function setField(list, item, key, raw) {
  const def = fieldsOf(list).find((f) => f.key === key);
  if (!def) return { ok: false, error: `no field “${key}” on this list` };
  const r = coerce(def, raw);
  if (!r.ok) return r;
  item.fields ??= {};
  if (r.value == null || r.value === false) delete item.fields[key];
  else item.fields[key] = r.value;
  if (!Object.keys(item.fields).length) delete item.fields;
  return r;
}

/** How a value reads on a card or in the side panel. */
export function formatField(def, value) {
  if (value == null || value === '' || value === false) return '';
  if (def.type === 'checkbox') return value ? 'Yes' : '';
  if (def.type === 'number') return String(value);
  return String(value);
}

/** True when the task passes a filter like { status: 'Ready' } (an empty filter passes everything). */
export function matchesFilter(item, filter) {
  for (const [k, v] of Object.entries(filter || {})) {
    if (v == null || v === '') continue;
    if ((getField(item, k) ?? '') !== v) return false;
  }
  return true;
}

/** Field text for search: every filled value, space-separated. */
export function searchText(list, item) {
  return fieldsOf(list).map((f) => formatField(f, getField(item, f.key))).filter(Boolean).join(' ');
}

/** The chip color name for a select value, if the field defines one. */
export const chipColor = (def, value) => (def.colors && value != null ? def.colors[value] || '' : '');

# Planner

A free, personal take on Notion's to-do lists: a whiteboard of draggable list cards, with a side
panel that plans your day against your real calendar.

```sh
npm run planner          # http://localhost:4310
npm run test:planner     # parser + feed tests
```

No dependencies: plain ES modules in `public/`, a small Node server in `server.mjs`.

## What it does

- **Whiteboard.** Pan (drag the background, or hold Space), zoom (pinch / ⌘-scroll), double-click
  to add a list. Lists and sticky notes are freeform rectangles: drag by the header, resize from the
  corner, recolor, collapse, connect with arrows. Progress bar per list.
- **Items.** Check off, click to rename, drag between lists. Details (⋯): due date, estimate,
  priority, repeat, course, link, steps, notes. Repeating items roll to the next date when checked
  (Notion can't do this). Archive completed items per list; restore from Settings.
- **Quick add** (`N` / `⌘K`): `hw3 fri 5pm #canvas ~2h !high every week`. `#tag` picks a list
  (or creates one), `~2h`/`~45m` sets the estimate, `!`/`!!`/`!!!` priority.
- **Today.** "Plan my day": classes + time blocks + estimated work due vs your daily capacity, with
  an overcommitment warning, auto-scheduling into free slots, overdue / today / next 7 days.
- **Calendar.** Month heatmap of workload. Day timeline with your events; drag a task onto it to
  block time (move/resize blocks by dragging), or onto a date to change its due date.
- **Canvas.** Paste the Canvas Calendar Feed URL: assignments flow into "Canvas school work" with the
  course, due date and link. Optional API token adds To Do items and syncs "done" back to Canvas.
- **Google Calendar.** Paste a calendar's secret iCal address (read-only, no setup), or add an OAuth
  client ID to read all calendars and push time blocks to Google.
- Focus timer (25/5) that logs time per task, due-date notifications, search (`/`), undo (`⌘Z`),
  light/dark, JSON export/import.

## Data

The board is one JSON document saved to `planner/data/board.json` (git-ignored) and to the
browser's localStorage. The Canvas token and Google access token stay in the browser only.

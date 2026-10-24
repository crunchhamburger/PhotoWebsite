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
- **Desk pet** (`‹ 奶龙 ›` switcher, top right): one 3D pet at a time: 奶龙, 奶蛙, 奶蛋 or 美团老鼠.
  It strolls slowly, turns to walk where it's going, looks at your cursor, naps (more at night or
  when you're idle), visits your lists to comment on them, likes being petted (hover), can be
  picked up (drag), chases treats, and cheers when you finish tasks. Click for a reaction,
  double-click for its signature move (laugh, side-eye, wobble, head shake…). Engine:
  `public/js/pets.js` (three.js, vendored in `public/vendor/`).

## Pet models

`public/models/<kind>.glb` are generated from reference pictures with Tencent Hunyuan3D-2.1 run
locally (the Apple-Silicon port in `~/hunyuan3d-mac-src`), shape + PBR texture at 6 views / 256 px.
They are fan-made models of copyrighted characters, so they are git-ignored and stay on this Mac.
`public/js/models3d.js` loads them (flipping Hunyuan's UVs, recomputing normals), fixes texture
colours the generator invented (`GLB_PETS`), and bends the head in a vertex shader. Without the
files, simple coded models are used instead. Preview all four at `/dev/models.html` (`?yaw=0`).

To regenerate one (about 15–25 min on an M4):

```sh
cd ~/hunyuan3d-mac-src/hunyuan3d-2.1-mac-rocm-main
PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0 venv/bin/python tests/e2e_visual.py --image <picture> \
  --out /tmp/pet --tex-preset safe --tex-views 6 --tex-resolution 256
cp outputs/<newest, not *_raw>.glb <planner>/public/models/<kind>.glb
```
- Focus timer (25/5) that logs time per task, due-date notifications, search (`/`), undo (`⌘Z`),
  light/dark, JSON export/import.

## Data

The board is one JSON document saved to `planner/data/board.json` (git-ignored) and to the
browser's localStorage. The Canvas token and Google access token stay in the browser only.

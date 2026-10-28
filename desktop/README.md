# Planner for Mac

The whiteboard planner (`../planner/public`) as a Mac app, with:

- **Many planners.** Every planner is its own board. *File › New Planner* (⇧⌘N) starts one from
  the starter lists, an empty board, or the same lists as another planner (optionally bringing its
  unfinished tasks). *File › All Planners* (⌘O) shows every planner you've made, with a mini map,
  open/done counts and when it was last edited; rename, duplicate, archive, export or move one to
  the Trash from its ⋯ menu.
- **Lists in their own window.** A list's ⋯ menu › *Open in its own window* pops it out as a small
  window that stays on top (pin button to change). It's the same list card: check off, add, edit,
  reorder. All windows of a planner stay in sync.
- **The pet on your desktop.** Pet panel › *Roam on my desktop* (or *Pet › Roam on the Desktop*,
  ⇧⌘P, or the paw in the menu bar). The pet walks around your screen on a transparent overlay that
  only catches the mouse over the pet itself, so it never blocks other apps. It follows your mouse
  to whichever screen you're on (switch off in the pet panel or the menu bar). Right-click it ›
  *Back to the planner* to bring it home.

Planners are saved in `~/Library/Application Support/Planner/planners/` (one JSON file each).

## Run it

```sh
cd desktop
npm install
npm start
```

`PLANNER_USER_DATA=/some/folder npm start` uses a scratch data folder instead of your real one.

## Build the installers

```sh
npm run icons   # only after changing scripts/icons.py (needs Python with Pillow)
npm run dist    # dist/Planner-<version>-arm64.dmg (Apple Silicon) and -x64.dmg (Intel)
```

The 3D pet models come from `../planner/public/models/` (not in git); build on a Mac that has them.

## Sharing with friends

Send the `.dmg` that matches their Mac (Apple menu › About This Mac: "Apple M…" chip → arm64,
"Intel" → x64). The app is ad-hoc signed, not notarized (that needs a paid Apple Developer
account), so the first launch needs one extra step, explained in *How to open Planner.txt* inside
the installer: System Settings › Privacy & Security › *Open Anyway*.

Google Calendar sign-in from the web version doesn't work in the app (Google only allows it on
registered websites); calendar feeds (the secret iCal address from Google Calendar, Canvas,
iCloud, Outlook) work as usual.

## Tests

```sh
npm test   # the planner library (create, carry over, rename, archive, trash, recover)
```

Copyright © 2026 Michael Wang. All rights reserved.

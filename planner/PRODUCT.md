# Product

<!-- impeccable:product-schema 1 -->

Scope: the planner only (`planner/`, `api/planner.js`, `desktop/`). The photography portfolio and
podcast pages in this repository are a separate product and are not described here.

## Platform

web

One codebase (`planner/public/`) ships three ways: the private website at haozhewang.com/planner
(used daily on the phone, installable to the home screen), the Mac app (`desktop/`, an Electron
shell around the same pages with native extras: several planner windows, pop-out list windows, a
menu-bar paw, and the pet roaming the desktop), and a localhost dev server (`planner/server.mjs`).

## Users

- **Michael (primary).** A student running his own week: classes and Canvas coursework, recruiting
  prep (banking, VC, quant), research and side projects. Uses it on the phone through the day
  (quick capture, voice notes, checking what's next) and on the Mac for planning on the whiteboard.
- **Friends (secondary, real).** People Michael shares the Mac app installer with. They use their
  own local planners; they don't sync to Michael's website and have no account system. Their needs
  count when a decision affects the Mac app.

## Product Purpose

A free, personal alternative to a Notion-style planner that fits how Michael actually works: lists
on a freeform board, the day's real time (classes, blocks, deadlines) beside them, and capture that
works from anywhere. Success: the day's plan is visible at a glance, nothing captured gets lost
between phone and Mac, and the overnight Night Shift turns evening voice notes into a usable
morning brief.

## Positioning

Derived from the build (Michael confirmed the four pillars below; the wording is ours):

- A **whiteboard of freeform lists and notes**, not a fixed list or database app.
- **Workload against real time**: Google/Canvas/iCal calendars, time blocks, a capacity in hours,
  and a Today view that says whether the day fits.
- **A night-and-morning loop** no general planner has: voice notes in the evening, the Night Shift
  runner working through a queue overnight, a Morning Brief (with questions for Michael) by
  morning.
- **A desk pet with personality**: 3D models of 奶龙, 奶蛙, 奶蛋 and 美团老鼠, Chinese speech
  bubbles, reactions, and on the Mac the pet roams the desktop.

## Operating Context

- **Phone, through the day:** add tasks with quick-add syntax (`hw3 fri 5pm #canvas ~2h !high`),
  record voice notes, read the morning brief, tick things off (swipe right to complete).
- **Mac, planning:** arrange lists on the board, time-block the day, pop lists out into floating
  windows, keep several planners (e.g. one per week) in the library.
- **Overnight:** `planner/nightshift.mjs` reads Ready jobs from the Night Queue, prepares job
  folders for agents, and writes results back (Done/Partial/Blocked, briefs, processed voice notes).
- **Sync:** the Mac app syncs one planner with the website (three-way merge per list and task,
  every 5 minutes, after edits, and daily at 7:30 via launchd); the phone pulls when it comes to the
  front.
- **Claude Code:** the `plan-my-day` skill reads the Mac planner and calendars and builds a
  time-blocked schedule in plan mode.

## Capabilities and Constraints

- Lists with tasks (due dates, estimates, priority, repeats, sub-steps, notes, Canvas links),
  sticky notes, connectors, hidden cards, archive; optional card fields that turn a list into a
  queue (Night Queue, Exploration Log, Voice Inbox, Morning Briefs presets).
- Side panel: Today, Brief, Voice, Calendar, Settings. Command bar: omnibox (add, find, commands),
  now/next chip, brief and voice buttons. Board dock and map.
- Board data is one JSON document per planner; secrets (Canvas token, Google token) never go in it.
- The website is private: one owner, password sign-in, data in private Vercel Blob storage. There
  are no other user accounts.
- The repository is public: no personal data, 3D models or secrets may be committed.
- Vanilla JS modules and CSS, no build step; three.js is vendored for the pets.
- Google Calendar sign-in doesn't work inside the Mac app (calendar feed links do).
- Undecided: whether friends ever get sync or accounts; the Obsidian-style linked map Michael wants
  later (a minimap navigator exists as a first step).

## Brand Commitments

- Name: **Planner**. Copyright © 2026 Michael Wang. All rights reserved.
- The meme characters (奶龙, 奶蛙, 奶蛋, 美团老鼠) belong to their creators: fine for personal and
  friends' use, never for sale.
- The pets speak in Chinese; the rest of the interface is in English.
- Must stay: the whiteboard, the 3D meme pets, the Night Shift loop, phone-first capture.

## Evidence on Hand

- Michael's real board (private; synced Mac copy in `~/Library/Application Support/Planner`).
- Night Shift outputs: real morning briefs and processed voice notes on the board.
- App icon (`desktop/build/icon.png`, `planner/public/icons/`), the four generated 3D pet models
  (`planner/public/models/`, not in git).
- No testimonials, users beyond Michael and friends, metrics or press exist; don't invent them.

## Product Principles

1. **Capture never waits.** Getting a task or a thought in takes one action from any surface,
   phone first; organizing can happen later.
2. **Time is real.** The plan is measured against calendars, blocks and capacity, not just a list.
3. **One planner everywhere.** Phone, website and Mac show the same thing; edits merge, never
   overwrite.
4. **The night works for the morning.** Evening input becomes a brief and next actions by morning.
5. **Personality is part of it.** The pets and small reactions are features, not decoration to
   strip out.

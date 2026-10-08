# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
A static web app that calculates the shift surcharges (§ 8 Abs. 1) and the Bereitschaftsdienst pay (§ 9) under the **TV-Ärzte (TdL, university hospitals)** for one month of shifts. The legal source is `input/tarifvertrag.pdf` (version 9. ÄndTV). Read it with `pdftotext -layout` when a rule is unclear. The UI and the code comments are in German.

## Commands
- Run the app: open `index.html` in a browser (works over `file://`). There is no build step, server or dependencies.
- Run the tests in the terminal: `gjs -m tests/run.js` (gjs is installed; Node is not).
- Run the tests in the browser: open `tests.html`.
- Running a single test: no filter exists. Temporarily comment out the other `test(...)` calls in `js/tests.js`.

## Architecture
- Scripts are **classic `<script>` tags sharing the global `window.DR`**, not ES modules, because Chrome blocks module imports over `file://`. Load order matters: `tariff.js` → `holidays.js` → `calc.js` → `app.js` / `tests.js`. Each module also sets `module.exports` for possible Node use.
- `js/tariff.js`: salary tables Anlage A1/A2/B1/B2 and the cut-over dates. Weekly hours are 42 until 2025 and 40 from 2026. Hourly rate = monthly amount / (4.348 × weekly hours), rounded to 2 decimals (§ 24 Abs. 3, 4). Night time is 21–6 before 01.04.2024 and 20–6 from then on; the Saturday window is 13–21 before and 13–20 after the same date. **A new Entgelttabelle means appending a new entry to `TABLES`.**
- `js/holidays.js`: computes Easter and the holidays for all 16 states (statewide holidays only).
- `js/calc.js`: pure `calculate(shifts, settings, month)`. It cuts each shift at 0/6/13/20/21 h and classifies each segment by date. Times are naive wall-clock times parsed as UTC, so DST is ignored on purpose.
- `js/app.js`: DOM and `localStorage`. Keys: `dr:settings`, `dr:month`, and `dr:YYYY-MM` for the shift list of each month.

## Tariff rules as implemented (keep them consistent)
- Regular work: the hours themselves are covered by the salary, so only surcharges are computed, on the **Stufe 3** rate. Night (20%) stacks with the rest. Of Sunday 25%, holiday 35% (with Freizeitausgleich) or 135% (without), 24./31.12. from 6:00 35%, and Saturday 13–20 h 20%, **only the highest** applies (§ 8 Abs. 1 S. 3).
- Bereitschaftsdienst: hours × rating × the **individual** rate (her own Stufe). Rating: Stufe I 60%, Stufe II 95% (global setting, § 9 Abs. 2). +25 pp on public holidays. +10 pp per BD beyond the 4th in the month (§ 9 Abs. 2a S. 1). A BD of ≤ 4 h between Mon 5:00 and Fri 21:00 counts as 0.5. On top: a night surcharge of 20% on the Stufe 3 rate; **no other § 8 surcharges** (§ 9 Abs. 4).
- Not implemented: breaks, overtime, Rufbereitschaft, Schicht/Wechselschicht allowances, § 7 Abs. 6a roster-change surcharges, § 9 Abs. 2a S. 2 (an ordered 5th BD). The page footer lists these, so update it when the scope changes.
- Every rule change needs a hand-calculated test case in `js/tests.js`.

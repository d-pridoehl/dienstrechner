# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
A static web app that calculates the shift surcharges (§ 8 Abs. 1) and the Bereitschaftsdienst pay (§ 9) under the **TV-Ärzte (TdL, university hospitals)** for one month of shifts. The legal source is `input/tarifvertrag.pdf` (version 9. ÄndTV). Read it with `pdftotext -layout` when a rule is unclear. The UI and the code comments are in German.

## Commands
- Run the app: open `index.html` in a browser (works over `file://`). There is no build step, server or dependencies.
- Run the tests in the terminal: `gjs -m tests/run.js` (gjs is installed; Node is not).
- Run the tests in the browser: open `tests.html`.
- Deployed via GitHub Pages from `master` (root) at https://d-pridoehl.github.io/dienstrechner/; every push to `master` goes live. It is meant to be reached by direct link only, so every HTML page carries `<meta name="robots" content="noindex, nofollow">`. A `robots.txt` would not work for this project subpath.
- Running a single test: no filter exists. Temporarily comment out the other `test(...)` calls in `js/tests.js`.

## Architecture
- Scripts are **classic `<script>` tags sharing the global `window.DR`**, not ES modules, because Chrome blocks module imports over `file://`. Load order matters: `tariff.js` → `holidays.js` → `calc.js` → `app.js` / `tests.js`. Each module also sets `module.exports` for possible Node use.
- `js/tariff.js`: salary tables Anlage A1/A2/B1/B2 from the PDF, plus the "Entgelttabelle 2026" (valid 01.04.2026–31.08.2027), which is **not in the PDF**. It was taken from oeffentlicher-dienst.info (URL in the code comment), and the user names that site as the authoritative source for current base salaries. Check numbers against the raw page HTML, not a summary: WebFetch's summary of that page once returned wrong amounts. Weekly hours are 42 until 2025 and 40 from 2026. Hourly rate = monthly amount / (4.348 × weekly hours), rounded to 2 decimals (§ 24 Abs. 3, 4). Night time is 21–6 before 01.04.2024 and 20–6 from then on; the Saturday window is 13–21 before and 13–20 after the same date. **A new Entgelttabelle means appending a new entry to `TABLES`.**
- `js/holidays.js`: computes Easter and the holidays for all 16 states (statewide holidays only).
- Shift types: `regular`, `bd`, `combined` ("Dienst mit Bereitschaft") and `off` ("Frei": no hours, only marks days as taken). `splitCombined` cuts a combined shift against **one** BD window from `bdWindow()`. The pieces keep the row index and count as one BD.
- The BD window follows the hospital's fixed times in `FIXED_TIMES` (`calc.js`). Day type comes from `dayType()`: Sundays and holidays (a holiday wins, also on a Saturday), Saturdays, and Werktage (Mon–Fri).
  - The BD *start* depends on the start day: Werktag = setting `bdStart` (default 20:00), Saturday 10:00, Sun/holiday 09:30.
  - The BD *end* depends on the following day: Werktag = setting `bdEnd` (default 08:00), Saturday 09:30, Sun/holiday 09:00.
  - `defaultTimes()` gives the pre-filled shift times. Start: Werktag 12:45, Sat 09:30, Sun/holiday 09:00. End: Werktag 09:00, Sat 10:00, Sun/holiday 09:30.
  - Time outside the window is handover and counts as regular work with surcharges.
- `js/calc.js`: pure `calculate(shifts, settings, month, prevShifts)`. `prevShifts` (the previous month's rows) only marks days of `month` as taken, e.g. a night starting on the 31st. It cuts each shift at 0/6/13/20/21 h and classifies each segment by date. Times are naive wall-clock times parsed as UTC, so DST is ignored on purpose.
- `js/app.js`: DOM and `localStorage`. Keys: `dr:settings` (with `v: 3`; older settings with `bdEnd` 07:00 are migrated to 08:00), `dr:month`, and `dr:YYYY-MM` for the shift list of each month. Each time is a date input plus two `<select>`s, hours 00–23 and minutes 00/15/30/45. This gives 24-h display regardless of browser locale, which `<input type="time">` can't guarantee. Off-grid stored values are added as an extra option, not dropped. The BD times in the settings use the same selects. Choosing a start date fills the end date (next day) and both times from `calc.defaultTimes()`, as does switching the type to `combined`/`off`. Changing a time or the end date alone keeps her input.

## Tariff rules as implemented (keep them consistent)
- Regular work: the hours themselves are covered by the salary, so only surcharges are computed, on the **Stufe 3** rate. Night (20%) stacks with the rest. Of Sunday 25%, holiday 35% (with Freizeitausgleich) or 135% (without), 24./31.12. from 6:00 35%, and Saturday 13–20 h 20%, **only the highest** applies (§ 8 Abs. 1 S. 3).
- Bereitschaftsdienst is **not paid per hour**. It is credited as working time: hours × rating. Rating: Stufe I 60%, Stufe II 95% (global setting, § 9 Abs. 2). +25 pp on public holidays. +10 pp per BD beyond the 4th in the month (§ 9 Abs. 2a S. 1). A BD of ≤ 4 h between Mon 5:00 and Fri 21:00 counts as 0.5. The BD night surcharge (20% on Stufe 3, § 9 Abs. 3) is always paid; **no other § 8 surcharges** apply (§ 9 Abs. 4).
- Monthly balance (`result.balance`):
  - Target = Mon–Fri non-holiday days × weekly hours / 5 (8 h from 2026, 8.4 h for 42-h tables).
  - Credited = standard days + entered regular hours + BD credited. Standard days are workdays touched by no row, which also covers vacation and sick days.
  - Only a positive saldo is paid, as row `bdPayout`, at 100% of the individual rate (her own Stufe). No carry-over between months.
  - The user confirmed this model, including that a night shift's off-days are exactly the calendar days it touches.
- Not implemented: breaks, overtime surcharges, Rufbereitschaft, Schicht/Wechselschicht allowances, § 7 Abs. 6a roster-change surcharges, § 9 Abs. 2a S. 2 (an ordered 5th BD). The page footer lists these, so update it when the scope changes.
- Result rows mirror the payslip:
  - Regular night work and BD night hours share **one** `night` row (same 20 % on Stufe 3).
  - Labels carry the time window of the surcharge, e.g. "(20–6 Uhr)", via `windowLabel()`.
  - Amount = hours × `hourly`, where `hourly` = round2(rate × percent) per § 24 Abs. 4. It is not hours × rate × percent.
- Every rule change needs a hand-calculated test case in `js/tests.js`.

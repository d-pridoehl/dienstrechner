// Berechnung der Zeitzuschläge (§ 8 Abs. 1) und des Bereitschaftsdienstentgelts (§ 9 Abs. 2–4)
// für die Dienste eines Monats. Reine Funktionen, kein DOM-Zugriff.
//
// Zeiten sind Wanduhrzeiten ohne Zeitzone: 'YYYY-MM-DDTHH:MM' wird als UTC geparst, damit
// Wochentag/Stunde unabhängig von der Zeitzone des Browsers sind. Zeitumstellungen werden
// daher nicht berücksichtigt.
(function (root) {
  'use strict';

  const T = (root.DR && root.DR.tariff) || require('./tariff.js');
  const H = (root.DR && root.DR.holidays) || require('./holidays.js');
  const { round2 } = T;

  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  const BD_RATING = { I: 60, II: 95 };

  function parse(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s || '');
    if (!m) return NaN;
    return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  }

  function dateOf(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  // Zerlegt [start, end) an allen Grenzen, an denen sich die Zuschlagsart ändern kann.
  function segments(start, end) {
    const cuts = [start, end];
    for (let day = Math.floor(start / DAY) * DAY; day < end; day += DAY) {
      for (const h of [0, 6, 13, 20, 21]) {
        const t = day + h * HOUR;
        if (t > start && t < end) cuts.push(t);
      }
    }
    cuts.sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < cuts.length - 1; i++) if (cuts[i] < cuts[i + 1]) out.push([cuts[i], cuts[i + 1]]);
    return out;
  }

  // Ein Segment liegt komplett innerhalb einer Stunde-Kategorie, daher reicht sein Anfang.
  function classify(ms, state) {
    const date = dateOf(ms);
    const hour = (ms % DAY) / HOUR;
    const weekday = new Date(ms).getUTCDay(); // 0 = Sonntag
    return {
      date,
      weekday,
      holiday: H.holidayName(date, state),
      night: hour >= T.nightStartHour(date) || hour < 6,
      saturdayWindow: weekday === 6 && hour >= 13 && hour < T.saturdayEndHour(date),
      christmasNewYearsEve: (date.slice(5) === '12-24' || date.slice(5) === '12-31') && hour >= 6,
    };
  }

  // § 7 Abs. 5a Protokollerklärung Nr. 1: Bereitschaftsdienste bis zu vier Stunden von
  // Montag 5 Uhr bis Freitag 21 Uhr zählen als 0,5 Dienst.
  function bdWeight(start, end) {
    if (end - start > 4 * HOUR) return 1;
    const weekday = new Date(start).getUTCDay();
    const daysSinceMonday = (weekday + 6) % 7;
    const monday5 = Math.floor(start / DAY) * DAY - daysSinceMonday * DAY + 5 * HOUR;
    const friday21 = monday5 + 4 * DAY + 16 * HOUR;
    return start >= monday5 && end <= friday21 ? 0.5 : 1;
  }

  const CATEGORIES = {
    night:     { label: 'Nachtarbeit',                         para: '§ 8 Abs. 1 b' },
    sunday:    { label: 'Sonntagsarbeit',                      para: '§ 8 Abs. 1 c' },
    holiday:   { label: 'Feiertagsarbeit mit Freizeitausgleich', para: '§ 8 Abs. 1 d' },
    holidayNo: { label: 'Feiertagsarbeit ohne Freizeitausgleich', para: '§ 8 Abs. 1 d' },
    xmas:      { label: 'Arbeit am 24./31. Dezember ab 6 Uhr',  para: '§ 8 Abs. 1 e' },
    saturday:  { label: 'Samstagsarbeit 13–20 Uhr',            para: '§ 8 Abs. 1 f' },
    bd:        { label: 'Bereitschaftsdienst',                 para: '§ 9 Abs. 2, 2a' },
    bdNight:   { label: 'Bereitschaftsdienst in der Nacht',    para: '§ 9 Abs. 3' },
  };

  // § 8 Abs. 1 Satz 3: von c bis f wird nur der höchste Zuschlag gezahlt.
  function highestDayBonus(c, settings) {
    const options = [];
    if (c.weekday === 0) options.push(['sunday', 25]);
    if (c.holiday) options.push(settings.holidayFreizeitausgleich ? ['holiday', 35] : ['holidayNo', 135]);
    if (c.christmasNewYearsEve) options.push(['xmas', 35]);
    if (c.saturdayWindow) options.push(['saturday', 20]);
    options.sort((a, b) => b[1] - a[1]);
    return options[0] || null;
  }

  /**
   * shifts:   [{ start: 'YYYY-MM-DDTHH:MM', end: ..., type: 'regular' | 'bd' }]
   * settings: { group: 'Ä1', stufe: 1–6, bdStufe: 'I' | 'II', state: 'NW', holidayFreizeitausgleich: bool }
   * month:    'YYYY-MM' – für Tabellenentgelt und Zuordnung der Bereitschaftsdienste
   */
  function calculate(shifts, settings, month) {
    const warnings = [];
    const rows = new Map();
    let regularHours = 0, bdHours = 0;

    function add(cat, hours, rate, percent, extraLabel) {
      const key = cat + '|' + rate + '|' + percent;
      if (!rows.has(key)) {
        rows.set(key, { cat, label: CATEGORIES[cat].label + (extraLabel || ''), para: CATEGORIES[cat].para, hours: 0, rate, percent });
      }
      rows.get(key).hours += hours;
    }

    const parsed = [];
    shifts.forEach((s, i) => {
      const start = parse(s.start), end = parse(s.end);
      if (isNaN(start) || isNaN(end)) { warnings.push(`Zeile ${i + 1}: Beginn oder Ende fehlt.`); return; }
      if (end <= start) { warnings.push(`Zeile ${i + 1}: Ende liegt nicht nach dem Beginn.`); return; }
      if (end - start > 25 * HOUR) warnings.push(`Zeile ${i + 1}: Dienst ist länger als 24 Stunden.`);
      if (dateOf(start).slice(0, 7) !== month) warnings.push(`Zeile ${i + 1}: Dienst beginnt nicht im gewählten Monat.`);
      parsed.push({ index: i, start, end, type: s.type === 'bd' ? 'bd' : 'regular' });
    });
    parsed.sort((a, b) => a.start - b.start);
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i].start < parsed[i - 1].end) warnings.push(`Zeilen ${parsed[i - 1].index + 1} und ${parsed[i].index + 1} überschneiden sich.`);
    }

    // § 9 Abs. 2a Satz 1: ab mehr als vier Diensten im Monat +10 Prozentpunkte, für jeden
    // weiteren Dienst weitere +10. Halbe Dienste zählen anteilig zur Anzahl.
    const bdServices = [];
    let bdCount = 0;
    for (const s of parsed) {
      if (s.type !== 'bd') continue;
      const weight = bdWeight(s.start, s.end);
      bdCount += weight;
      const extra = bdCount > 4 ? 10 * Math.ceil(bdCount - 4) : 0;
      s.bdExtra = extra;
      bdServices.push({ index: s.index, start: s.start, weight, count: bdCount, extra });
    }

    const base = BD_RATING[settings.bdStufe] || BD_RATING.I;

    for (const s of parsed) {
      for (const [a, b] of segments(s.start, s.end)) {
        const hours = (b - a) / HOUR;
        const c = classify(a, settings.state);
        const rate3 = T.hourlyRate(c.date, settings.group, 3);
        if (s.type === 'regular') {
          regularHours += hours;
          if (c.night) add('night', hours, rate3, 20);
          const bonus = highestDayBonus(c, settings);
          if (bonus) add(bonus[0], hours, rate3, bonus[1]);
        } else {
          bdHours += hours;
          const rateInd = T.hourlyRate(c.date, settings.group, settings.stufe);
          const rating = base + s.bdExtra + (c.holiday ? 25 : 0);
          const parts = [`Stufe ${settings.bdStufe}`];
          if (s.bdExtra) parts.push(`+${s.bdExtra} Pp. Mehrdienst`);
          if (c.holiday) parts.push('+25 Pp. Feiertag');
          add('bd', hours, rateInd, rating, ' (' + parts.join(', ') + ')');
          if (c.night) add('bdNight', hours, rate3, 20);
        }
      }
    }

    const order = Object.keys(CATEGORIES);
    const result = [...rows.values()]
      .map((r) => ({ ...r, hours: round2(r.hours), amount: round2(r.hours * r.rate * r.percent / 100) }))
      .sort((x, y) => order.indexOf(x.cat) - order.indexOf(y.cat) || x.percent - y.percent || x.rate - y.rate);

    const firstOfMonth = month + '-01';
    return {
      rows: result,
      total: round2(result.reduce((sum, r) => sum + r.amount, 0)),
      regularHours: round2(regularHours),
      bdHours: round2(bdHours),
      bdServices,
      bdCount,
      table: T.tableFor(firstOfMonth).name,
      baseSalary: T.monthlySalary(firstOfMonth, settings.group, settings.stufe),
      rateStufe3: T.hourlyRate(firstOfMonth, settings.group, 3),
      rateIndividual: T.hourlyRate(firstOfMonth, settings.group, settings.stufe),
      warnings,
    };
  }

  const api = { calculate, parse, segments, classify, bdWeight, CATEGORIES };
  root.DR = root.DR || {};
  root.DR.calc = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

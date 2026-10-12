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

  // Hausinterne Zeiten für "Dienst mit Bereitschaft". Werktags gelten die einstellbaren
  // Bereitschaftszeiten, an Samstagen, Sonn- und Feiertagen feste Zeiten. Die Anwesenheit vor
  // und nach dem Bereitschaftsdienst (Schichtübergabe) zählt als Regelarbeit.
  const DEFAULT_BD_START = '20:00';
  const DEFAULT_BD_END = '08:00';
  const FIXED_TIMES = {
    // Dienst- und BD-Beginn richten sich nach dem Tag, an dem der Dienst beginnt.
    start: {
      werktag:      { shift: '12:45', bd: null }, // null: Einstellung bdStart
      samstag:      { shift: '09:30', bd: '10:00' },
      sonnFeiertag: { shift: '09:00', bd: '09:30' },
    },
    // BD- und Dienstende richten sich nach dem Folgetag.
    end: {
      werktag:      { bd: null, shift: '09:00' },  // null: Einstellung bdEnd
      samstag:      { bd: '09:30', shift: '10:00' },
      sonnFeiertag: { bd: '09:00', shift: '09:30' },
    },
  };

  function validTime(hhmm, fallback) {
    return /^\d{2}:\d{2}/.test(hhmm || '') ? hhmm.slice(0, 5) : fallback;
  }

  function nextDate(date) {
    return dateOf(Date.parse(date + 'T00:00:00Z') + DAY);
  }

  // Feiertage gehen vor, auch wenn sie auf einen Samstag fallen.
  function dayType(date, state) {
    if (H.holidayName(date, state)) return 'sonnFeiertag';
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    return weekday === 0 ? 'sonnFeiertag' : weekday === 6 ? 'samstag' : 'werktag';
  }

  // Bereitschaftsdienst-Fenster [Beginn, Ende) eines Dienstes, der am Tag von `start` beginnt.
  function bdWindow(start, settings) {
    const d0 = dateOf(start), d1 = nextDate(d0);
    const bdStart = FIXED_TIMES.start[dayType(d0, settings.state)].bd || validTime(settings.bdStart, DEFAULT_BD_START);
    const bdEnd = FIXED_TIMES.end[dayType(d1, settings.state)].bd || validTime(settings.bdEnd, DEFAULT_BD_END);
    return [parse(d0 + 'T' + bdStart), parse(d1 + 'T' + bdEnd)];
  }

  // Vorschlag für Beginn und Ende eines "Dienstes mit Bereitschaft" am Tag `date`.
  function defaultTimes(date, settings) {
    const d1 = nextDate(date);
    return {
      start: date + 'T' + FIXED_TIMES.start[dayType(date, settings.state)].shift,
      end: d1 + 'T' + FIXED_TIMES.end[dayType(d1, settings.state)].shift,
    };
  }

  // Zerlegt einen Dienst vom Typ 'combined' in Regelarbeit und Bereitschaftsdienst.
  // Liefert [{ start, end, type }] in zeitlicher Reihenfolge.
  function splitCombined(start, end, settings) {
    const [from, to] = bdWindow(start, settings);
    const a = Math.max(start, from), b = Math.min(end, to);
    if (a >= b) return [{ start, end, type: 'regular' }];
    const pieces = [];
    if (start < a) pieces.push({ start, end: a, type: 'regular' });
    pieces.push({ start: a, end: b, type: 'bd' });
    if (b < end) pieces.push({ start: b, end, type: 'regular' });
    return pieces;
  }

  // Alle Kalendertage, die [start, end) berührt. Ein Ende um 0:00 berührt den Tag nicht.
  function touchedDays(start, end) {
    const days = [];
    for (let t = Math.floor(start / DAY) * DAY; t < end; t += DAY) days.push(dateOf(t));
    return days;
  }

  const CATEGORIES = {
    // Nachtarbeit und Bereitschaftsdienst in der Nacht haben denselben Zuschlag (20 % auf
    // Stufe 3) und stehen auf der Gehaltsabrechnung in einer Zeile.
    night:     { label: 'Nachtarbeit',                           para: '§ 8 Abs. 1 b, § 9 Abs. 3' },
    sunday:    { label: 'Sonntagsarbeit',                        para: '§ 8 Abs. 1 c' },
    holiday:   { label: 'Feiertagsarbeit mit Freizeitausgleich',   para: '§ 8 Abs. 1 d' },
    holidayNo: { label: 'Feiertagsarbeit ohne Freizeitausgleich',  para: '§ 8 Abs. 1 d' },
    xmas:      { label: 'Arbeit am 24./31. Dezember',             para: '§ 8 Abs. 1 e' },
    saturday:  { label: 'Samstagsarbeit',                        para: '§ 8 Abs. 1 f' },
    bdPayout:  { label: 'Bereitschaftsdienst (Saldo Arbeitszeitkonto)',   para: '§ 8 Abs. 4, § 9 Abs. 2' },
  };

  // Zeitfenster, in dem der Zuschlag gilt, für die Anzeige hinter der Kategorie.
  function windowLabel(cat, date) {
    switch (cat) {
      case 'night': return `${T.nightStartHour(date)}–6 Uhr`;
      case 'saturday': return `13–${T.saturdayEndHour(date)} Uhr`;
      case 'xmas': return '6–24 Uhr';
      case 'sunday': case 'holiday': case 'holidayNo': return '0–24 Uhr';
      default: return '';
    }
  }

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
   * shifts:     [{ start: 'YYYY-MM-DDTHH:MM', end: ..., type: 'regular' | 'bd' | 'combined' | 'off' }]
   * settings:   { group: 'Ä1', stufe: 1–6, bdStufe: 'I' | 'II', state: 'NW', holidayFreizeitausgleich: bool,
   *               bdStart: 'HH:MM', bdEnd: 'HH:MM' }
   * month:      'YYYY-MM' – für Tabellenentgelt, Sollstunden und Zuordnung der Bereitschaftsdienste
   * prevShifts: Dienste des Vormonats; nur die von ihnen berührten Tage in `month` zählen
   *             (ein Nachtdienst am 31. belegt den 1. des Folgemonats).
   *
   * Arbeitszeitkonto: Soll = Werktage (Mo–Fr ohne Feiertage) × Wochenstunden/5. Ist = Werktage
   * ohne eingetragenen Dienst als Standardtag + Regelarbeit + Bereitschaftsdienst × Bewertung.
   * Nur ein positiver Saldo wird mit dem individuellen Stundenentgelt ausgezahlt.
   */
  function calculate(shifts, settings, month, prevShifts) {
    const warnings = [];
    const rows = new Map();
    const touched = new Set();
    const bdCredit = new Map();
    let regularHours = 0, bdHours = 0, bdCredited = 0;

    function add(cat, hours, rate, percent, date) {
      const win = windowLabel(cat, date);
      const label = CATEGORIES[cat].label + (win ? ' (' + win + ')' : '');
      const key = cat + '|' + rate + '|' + percent + '|' + label;
      if (!rows.has(key)) rows.set(key, { cat, label, para: CATEGORIES[cat].para, hours: 0, rate, percent });
      rows.get(key).hours += hours;
    }

    const parsed = [];
    shifts.forEach((s, i) => {
      const start = parse(s.start), end = parse(s.end);
      if (isNaN(start) || isNaN(end)) { warnings.push(`Zeile ${i + 1}: Beginn oder Ende fehlt.`); return; }
      if (end <= start) { warnings.push(`Zeile ${i + 1}: Ende liegt nicht nach dem Beginn.`); return; }
      if (end - start > 25 * HOUR) warnings.push(`Zeile ${i + 1}: Dienst ist länger als 24 Stunden.`);
      if (dateOf(start).slice(0, 7) !== month) warnings.push(`Zeile ${i + 1}: Dienst beginnt nicht im gewählten Monat.`);
      touchedDays(start, end).forEach((d) => touched.add(d));
      if (s.type === 'off') return;
      if (s.type === 'combined') {
        for (const p of splitCombined(start, end, settings)) parsed.push({ index: i, ...p });
      } else {
        parsed.push({ index: i, start, end, type: s.type === 'bd' ? 'bd' : 'regular' });
      }
    });
    for (const s of prevShifts || []) {
      const start = parse(s.start), end = parse(s.end);
      if (!isNaN(start) && !isNaN(end) && end > start) touchedDays(start, end).forEach((d) => touched.add(d));
    }
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
          if (c.night) add('night', hours, rate3, 20, c.date);
          const bonus = highestDayBonus(c, settings);
          if (bonus) add(bonus[0], hours, rate3, bonus[1], c.date);
        } else {
          bdHours += hours;
          const rating = base + s.bdExtra + (c.holiday ? 25 : 0);
          bdCredited += hours * rating / 100;
          if (!bdCredit.has(rating)) {
            const parts = [`Stufe ${settings.bdStufe || 'I'}`];
            if (s.bdExtra) parts.push(`+${s.bdExtra} Pp. Mehrdienst`);
            if (c.holiday) parts.push('+25 Pp. Feiertag');
            bdCredit.set(rating, { label: parts.join(', '), rating, hours: 0 });
          }
          bdCredit.get(rating).hours += hours;
          if (c.night) add('night', hours, rate3, 20, c.date); // § 9 Abs. 3
        }
      }
    }

    // Sollstunden und automatisch angenommene Standardtage
    let workdays = 0, target = 0, autoDays = 0, autoHours = 0;
    const [y, m] = month.split('-').map(Number);
    for (let t = Date.UTC(y, m - 1, 1); dateOf(t).slice(0, 7) === month; t += DAY) {
      const date = dateOf(t);
      if (dayType(date, settings.state) !== 'werktag') continue;
      const daily = T.tableFor(date).weeklyHours / 5;
      workdays++;
      target += daily;
      if (!touched.has(date)) { autoDays++; autoHours += daily; }
    }
    const credited = autoHours + regularHours + bdCredited;
    const saldo = round2(credited) - round2(target);
    const payoutHours = Math.max(0, round2(saldo));

    const firstOfMonth = month + '-01';
    const rateIndividual = T.hourlyRate(firstOfMonth, settings.group, settings.stufe);
    if (payoutHours > 0) add('bdPayout', payoutHours, rateIndividual, 100, firstOfMonth);

    const order = Object.keys(CATEGORIES);
    const result = [...rows.values()]
      // § 24 Abs. 4: Stundensatz (Satz × Stundenentgelt) wird auf Cent gerundet, dann mit den Stunden multipliziert.
      .map((r) => {
        const hourly = round2(r.rate * r.percent / 100);
        return { ...r, hours: round2(r.hours), hourly, amount: round2(r.hours * hourly) };
      })
      .sort((x, y) => order.indexOf(x.cat) - order.indexOf(y.cat) || x.percent - y.percent || x.rate - y.rate);

    return {
      rows: result,
      total: round2(result.reduce((sum, r) => sum + r.amount, 0)),
      regularHours: round2(regularHours),
      bdHours: round2(bdHours),
      bdServices,
      bdCount,
      balance: {
        workdays,
        target: round2(target),
        autoDays,
        autoHours: round2(autoHours),
        regularHours: round2(regularHours),
        bdCredited: round2(bdCredited),
        bdCredit: [...bdCredit.values()]
          .sort((a, b) => a.rating - b.rating)
          .map((r) => ({ ...r, hours: round2(r.hours), credited: round2(r.hours * r.rating / 100) })),
        credited: round2(credited),
        saldo: round2(saldo),
        payoutHours,
      },
      table: T.tableFor(firstOfMonth).name,
      baseSalary: T.monthlySalary(firstOfMonth, settings.group, settings.stufe),
      rateStufe3: T.hourlyRate(firstOfMonth, settings.group, 3),
      rateIndividual,
      warnings,
    };
  }

  const api = {
    calculate, parse, segments, classify, bdWeight, splitCombined, bdWindow, defaultTimes, dayType,
    CATEGORIES, FIXED_TIMES, DEFAULT_BD_START, DEFAULT_BD_END,
  };
  root.DR = root.DR || {};
  root.DR.calc = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

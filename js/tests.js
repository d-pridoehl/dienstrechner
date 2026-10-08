// Testfälle mit von Hand nachgerechneten Werten. Werden von tests.html (Browser) und
// tests/run.js (gjs) ausgeführt.
(function (root) {
  'use strict';

  const { calc, tariff, holidays } = root.DR;
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  function eq(actual, expected, what) {
    if (actual !== expected) throw new Error(`${what || 'Wert'}: erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(actual)}`);
  }

  const S = (over) => Object.assign({ group: 'Ä1', stufe: 1, bdStufe: 'I', state: 'NW', holidayFreizeitausgleich: true }, over);
  const shift = (start, end, type) => ({ start, end, type: type || 'regular' });
  // Summe der Stunden/Beträge einer Kategorie (ggf. über mehrere Prozentsätze)
  const row = (res, cat, percent) => {
    const rs = res.rows.filter((r) => r.cat === cat && (percent === undefined || r.percent === percent));
    return { hours: tariff.round2(rs.reduce((s, r) => s + r.hours, 0)), amount: tariff.round2(rs.reduce((s, r) => s + r.amount, 0)) };
  };

  // --- Tarif ---------------------------------------------------------------
  test('Stundenentgelt Ä1 Stufe 3, Anlage B 1 (42 h)', () => {
    eq(tariff.hourlyRate('2025-06-01', 'Ä1', 3), 33.81); // 6173,67 / (4,348 × 42)
  });
  test('Stundenentgelt Ä1 Stufe 3, Anlage B 2 (40 h)', () => {
    eq(tariff.hourlyRate('2026-01-01', 'Ä1', 3), 35.50); // 6173,67 / (4,348 × 40)
  });
  test('Stundenentgelt Ä1 Stufe 1, Anlage B 2', () => {
    eq(tariff.hourlyRate('2026-03-01', 'Ä1', 1), 32.35); // 5626,91 / 173,92
  });
  test('Stundenentgelt Entgelttabelle 2026 (ab 01.04.2026)', () => {
    eq(tariff.hourlyRate('2026-10-01', 'Ä1', 3), 36.54); // 6355,79 / 173,92
    eq(tariff.hourlyRate('2026-10-01', 'Ä1', 1), 33.31); // 5792,90 / 173,92
  });
  test('Tabellenwechsel zum 1. April 2024', () => {
    eq(tariff.tableFor('2024-03-31').name, 'Anlage A 1');
    eq(tariff.tableFor('2024-04-01').name, 'Anlage A 2');
  });
  test('Tabellenwechsel zum 1. April 2026', () => {
    eq(tariff.tableFor('2026-03-31').name, 'Anlage B 2');
    eq(tariff.tableFor('2026-04-01').name, 'Entgelttabelle 2026');
    eq(tariff.monthlySalary('2026-04-01', 'Ä1', 3), 6355.79);
  });

  // --- Feiertage -----------------------------------------------------------
  test('Ostersonntag', () => {
    eq(holidays.easter(2024), '2024-03-31');
    eq(holidays.easter(2025), '2025-04-20');
    eq(holidays.easter(2026), '2026-04-05');
  });
  test('Bewegliche und landesspezifische Feiertage 2026', () => {
    eq(holidays.holidayName('2026-06-04', 'NW'), 'Fronleichnam');
    eq(holidays.holidayName('2026-06-04', 'BE'), null);
    eq(holidays.holidayName('2026-11-01', 'NW'), 'Allerheiligen');
    eq(holidays.holidayName('2026-10-31', 'NI'), 'Reformationstag');
    eq(holidays.holidayName('2026-10-31', 'NW'), null);
    eq(holidays.holidayName('2026-11-18', 'SN'), 'Buß- und Bettag');
    eq(holidays.holidayName('2026-05-14', 'BY'), 'Christi Himmelfahrt');
    eq(holidays.holidayName('2026-05-25', 'HH'), 'Pfingstmontag');
  });

  // --- Regelarbeit (§ 8 Abs. 1) ----------------------------------------------
  test('Nachtdienst Fr 20 Uhr – Sa 8 Uhr: 10 h Nacht, Samstag 6–8 Uhr zuschlagsfrei', () => {
    const r = calc.calculate([shift('2026-10-09T20:00', '2026-10-10T08:00')], S(), '2026-10');
    eq(row(r, 'night').hours, 10);
    eq(row(r, 'night').amount, 73.08); // 10 × 36,54 × 20 %
    eq(row(r, 'saturday').hours, 0);
    eq(r.total, 73.08);
    eq(r.regularHours, 12);
  });
  test('Samstag 12–22 Uhr: 7 h Samstagszuschlag (13–20) und 2 h Nacht', () => {
    const r = calc.calculate([shift('2026-10-10T12:00', '2026-10-10T22:00')], S(), '2026-10');
    eq(row(r, 'saturday').hours, 7);
    eq(row(r, 'night').hours, 2);
  });
  test('Vor April 2024: Samstag bis 21 Uhr, Nacht ab 21 Uhr', () => {
    const r = calc.calculate([shift('2024-03-16T13:00', '2024-03-16T22:00')], S(), '2024-03');
    eq(row(r, 'saturday').hours, 8);
    eq(row(r, 'night').hours, 1);
  });
  test('Sonntag, der Feiertag ist: nur der höhere Feiertagszuschlag (NW, Allerheiligen)', () => {
    const r = calc.calculate([shift('2026-11-01T10:00', '2026-11-01T14:00')], S(), '2026-11');
    eq(row(r, 'sunday').hours, 0);
    eq(row(r, 'holiday', 35).hours, 4);
  });
  test('Feiertag ohne Freizeitausgleich: 135 %', () => {
    const r = calc.calculate([shift('2026-11-01T10:00', '2026-11-01T14:00')], S({ holidayFreizeitausgleich: false }), '2026-11');
    eq(row(r, 'holidayNo', 135).hours, 4);
    eq(row(r, 'holidayNo').amount, 197.32); // 4 × 36,54 × 135 %
  });
  test('Gleicher Sonntag in Berlin (kein Feiertag): 25 % Sonntagszuschlag', () => {
    const r = calc.calculate([shift('2026-11-01T10:00', '2026-11-01T14:00')], S({ state: 'BE' }), '2026-11');
    eq(row(r, 'sunday', 25).hours, 4);
    eq(row(r, 'holiday').hours, 0);
  });
  test('24. Dezember: 35 % erst ab 6 Uhr, davor nur Nacht', () => {
    const r = calc.calculate([shift('2026-12-24T04:00', '2026-12-24T10:00')], S(), '2026-12');
    eq(row(r, 'xmas', 35).hours, 4);
    eq(row(r, 'night').hours, 2);
  });

  // --- Bereitschaftsdienst (§ 9) -----------------------------------------------
  test('BD Stufe I Di 16 Uhr – Mi 8 Uhr: 60 % individuelles Entgelt + Nachtzuschlag', () => {
    const r = calc.calculate([shift('2026-10-13T16:00', '2026-10-14T08:00', 'bd')], S(), '2026-10');
    eq(row(r, 'bd', 60).hours, 16);
    eq(row(r, 'bd').amount, 319.78); // 16 × 33,31 × 60 %
    eq(row(r, 'bdNight').hours, 10);
    eq(row(r, 'bdNight').amount, 73.08); // 10 × 36,54 (Stufe 3) × 20 %
    eq(row(r, 'night').hours, 0);
  });
  test('Gleicher BD in Stufe II: 95 %', () => {
    const r = calc.calculate([shift('2026-10-13T16:00', '2026-10-14T08:00', 'bd')], S({ bdStufe: 'II' }), '2026-10');
    eq(row(r, 'bd', 95).hours, 16);
    eq(row(r, 'bd').amount, 506.31); // 16 × 33,31 × 95 %
  });
  test('BD Stufe II am Feiertag: 120 %, keine weiteren § 8-Zuschläge', () => {
    const r = calc.calculate([shift('2026-10-03T08:00', '2026-10-03T20:00', 'bd')], S({ bdStufe: 'II' }), '2026-10');
    eq(row(r, 'bd', 120).hours, 12);
    eq(row(r, 'bd').amount, 479.66); // 12 × 33,31 × 120 %
    eq(row(r, 'saturday').hours, 0);
    eq(row(r, 'holiday').hours, 0);
  });
  test('Fünfter BD im Monat: 70 %, sechster 80 % (Stufe I)', () => {
    const days = ['05', '06', '07', '08', '12', '13'];
    const shifts = days.map((d) => shift(`2026-10-${d}T16:00`, `2026-10-${String(+d + 1).padStart(2, '0')}T08:00`, 'bd'));
    const r = calc.calculate(shifts, S(), '2026-10');
    eq(row(r, 'bd', 60).hours, 64);
    eq(row(r, 'bd', 70).hours, 16);
    eq(row(r, 'bd', 80).hours, 16);
  });
  test('Kurzer BD (≤ 4 h, werktags) zählt als halber Dienst', () => {
    eq(calc.bdWeight(calc.parse('2026-10-13T17:00'), calc.parse('2026-10-13T21:00')), 0.5);
    eq(calc.bdWeight(calc.parse('2026-10-16T18:00'), calc.parse('2026-10-16T22:00')), 1); // Fr bis 22 Uhr
    eq(calc.bdWeight(calc.parse('2026-10-10T10:00'), calc.parse('2026-10-10T14:00')), 1); // Samstag
  });

  // --- Dienst mit Bereitschaft (Aufteilung nach Bereitschaftszeit) ------------------
  test('Dienst mit Bereitschaft Di 12 Uhr – Mi 7 Uhr: 8 h Regelarbeit, 11 h BD (20–7 Uhr)', () => {
    const r = calc.calculate([shift('2026-10-13T12:00', '2026-10-14T07:00', 'combined')], S({ bdStart: '20:00', bdEnd: '07:00' }), '2026-10');
    eq(r.regularHours, 8);
    eq(r.bdHours, 11);
    eq(row(r, 'night').hours, 0);
    eq(row(r, 'bd', 60).amount, 219.85); // 11 × 33,31 × 60 %
    eq(row(r, 'bdNight').hours, 10);       // 20–6 Uhr
    eq(r.bdCount, 1);
  });
  test('Bereitschaftszeit 21:00–06:30: Rest davor und danach ist Regelarbeit', () => {
    const r = calc.calculate([shift('2026-10-13T12:00', '2026-10-14T07:00', 'combined')], S({ bdStart: '21:00', bdEnd: '06:30' }), '2026-10');
    eq(r.regularHours, 9.5);           // 12–21 Uhr und 6:30–7 Uhr
    eq(r.bdHours, 9.5);
    eq(row(r, 'night').hours, 1);      // Regelarbeit 20–21 Uhr
    eq(row(r, 'bdNight').hours, 9);    // BD 21–6 Uhr
  });
  test('Ohne Einstellung gelten 20:00–07:00 als Bereitschaftszeit', () => {
    const p = calc.splitCombined(calc.parse('2026-10-13T12:00'), calc.parse('2026-10-14T09:00'), {});
    eq(p.map((x) => x.type).join(','), 'regular,bd,regular');
    eq((p[1].end - p[1].start) / 3600000, 11);
  });
  test('Dienst endet vor Beginn der Bereitschaftszeit: nur Regelarbeit', () => {
    const p = calc.splitCombined(calc.parse('2026-10-13T08:00'), calc.parse('2026-10-13T16:00'), { bdStart: '20:00', bdEnd: '07:00' });
    eq(p.length, 1);
    eq(p[0].type, 'regular');
  });

  // --- Eingabeprüfung ----------------------------------------------------------
  test('Ungültige und überlappende Zeilen erzeugen Warnungen', () => {
    const r = calc.calculate([
      shift('2026-10-01T20:00', '2026-10-01T19:00'),
      shift('2026-10-02T20:00', '2026-10-03T08:00'),
      shift('2026-10-03T07:00', '2026-10-03T09:00'),
    ], S(), '2026-10');
    eq(r.warnings.length, 2);
  });

  function run() {
    return tests.map(({ name, fn }) => {
      try { fn(); return { name, ok: true }; } catch (e) { return { name, ok: false, error: e.message }; }
    });
  }

  root.DR.tests = { run };
})(typeof window !== 'undefined' ? window : globalThis);

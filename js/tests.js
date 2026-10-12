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
    eq(row(r, 'night').amount, 73.10); // 10 × 7,31 (36,54 × 20 %, auf Cent gerundet)
    eq(row(r, 'saturday').hours, 0);
    eq(r.balance.saldo, 4); // 12 h am Freitag statt 8 h Standardtag
    eq(r.regularHours, 12);
  });
  test('Stundensatz = Satz × Stundenentgelt, gerundet; Zeitfenster im Namen', () => {
    const r = calc.calculate([shift('2026-10-10T12:00', '2026-10-10T22:00')], S(), '2026-10');
    const night = r.rows.find((x) => x.cat === 'night');
    eq(night.hourly, 7.31);            // 36,54 × 20 %
    eq(night.label, 'Nachtarbeit (20–6 Uhr)');
    eq(r.rows.find((x) => x.cat === 'saturday').label, 'Samstagsarbeit (13–20 Uhr)');
    const old = calc.calculate([shift('2024-03-16T13:00', '2024-03-16T22:00')], S(), '2024-03');
    eq(old.rows.find((x) => x.cat === 'night').label, 'Nachtarbeit (21–6 Uhr)');
    eq(old.rows.find((x) => x.cat === 'saturday').label, 'Samstagsarbeit (13–21 Uhr)');
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

  // --- Bereitschaftsdienst (§ 9): Bewertung als Arbeitszeit ----------------------
  // Angerechnete BD-Stunden je Bewertung (in Prozent)
  const credit = (res, rating) => {
    const c = res.balance.bdCredit.find((x) => x.rating === rating);
    return c ? c.hours : 0;
  };

  test('BD Stufe I Di 16 Uhr – Mi 8 Uhr: 60 % angerechnet + Nachtzuschlag', () => {
    const r = calc.calculate([shift('2026-10-13T16:00', '2026-10-14T08:00', 'bd')], S(), '2026-10');
    eq(credit(r, 60), 16);
    eq(r.balance.bdCredited, 9.6);        // 16 × 60 %
    eq(row(r, 'night').hours, 10);        // BD 20–6 Uhr, § 9 Abs. 3
    eq(row(r, 'night').amount, 73.10);    // 10 × 7,31
  });
  test('Gleicher BD in Stufe II: 95 %', () => {
    const r = calc.calculate([shift('2026-10-13T16:00', '2026-10-14T08:00', 'bd')], S({ bdStufe: 'II' }), '2026-10');
    eq(r.balance.bdCredited, 15.2);       // 16 × 95 %
  });
  test('BD Stufe II am Feiertag: 120 %, keine weiteren § 8-Zuschläge', () => {
    const r = calc.calculate([shift('2026-10-03T08:00', '2026-10-03T20:00', 'bd')], S({ bdStufe: 'II' }), '2026-10');
    eq(credit(r, 120), 12);
    eq(r.balance.bdCredited, 14.4);
    eq(row(r, 'saturday').hours, 0);
    eq(row(r, 'holiday').hours, 0);
  });
  test('BD Stufe I am Feiertag: 85 %', () => {
    const r = calc.calculate([shift('2026-10-03T08:00', '2026-10-03T20:00', 'bd')], S(), '2026-10');
    eq(credit(r, 85), 12);
  });
  test('Fünfter BD im Monat: 70 %, sechster 80 % (Stufe I)', () => {
    const days = ['05', '06', '07', '08', '12', '13'];
    const shifts = days.map((d) => shift(`2026-10-${d}T16:00`, `2026-10-${String(+d + 1).padStart(2, '0')}T08:00`, 'bd'));
    const r = calc.calculate(shifts, S(), '2026-10');
    eq(credit(r, 60), 64);
    eq(credit(r, 70), 16);
    eq(credit(r, 80), 16);
  });
  test('Kurzer BD (≤ 4 h, werktags) zählt als halber Dienst', () => {
    eq(calc.bdWeight(calc.parse('2026-10-13T17:00'), calc.parse('2026-10-13T21:00')), 0.5);
    eq(calc.bdWeight(calc.parse('2026-10-16T18:00'), calc.parse('2026-10-16T22:00')), 1); // Fr bis 22 Uhr
    eq(calc.bdWeight(calc.parse('2026-10-10T10:00'), calc.parse('2026-10-10T14:00')), 1); // Samstag
  });

  // --- Dienst mit Bereitschaft: feste BD-Fenster je Tagesart ------------------------
  const W = { bdStart: '20:00', bdEnd: '08:00' };
  const hm = (ms) => new Date(ms).toISOString().slice(0, 16);

  test('Werktag Di 12:45 – Mi 9:00: 8,25 h Regelarbeit, 12 h BD (20–8 Uhr)', () => {
    const r = calc.calculate([shift('2026-10-13T12:45', '2026-10-14T09:00', 'combined')], S(W), '2026-10');
    eq(r.regularHours, 8.25);          // 12:45–20:00 und Übergabe 8–9 Uhr
    eq(r.bdHours, 12);
    eq(r.balance.bdCredited, 7.2);
    eq(row(r, 'night').hours, 10);     // nur BD 20–6 Uhr
    eq(r.bdCount, 1);
  });
  test('Werktag mit eigener Bereitschaftszeit 21:00–06:30', () => {
    const r = calc.calculate([shift('2026-10-13T12:00', '2026-10-14T07:00', 'combined')], S({ bdStart: '21:00', bdEnd: '06:30' }), '2026-10');
    eq(r.regularHours, 9.5);           // 12–21 Uhr und 6:30–7 Uhr
    eq(r.bdHours, 9.5);
    eq(row(r, 'night').hours, 10);     // Regelarbeit 20–21 Uhr + BD 21–6 Uhr
    eq(r.rows.filter((x) => x.cat === 'night').length, 1); // eine gemeinsame Zeile
  });
  test('Ohne Einstellung gelten werktags 20:00–08:00', () => {
    const p = calc.splitCombined(calc.parse('2026-10-13T12:00'), calc.parse('2026-10-14T09:00'), {});
    eq(p.map((x) => x.type).join(','), 'regular,bd,regular');
    eq((p[1].end - p[1].start) / 3600000, 12);
  });
  test('Dienst endet vor Beginn der Bereitschaftszeit: nur Regelarbeit', () => {
    const p = calc.splitCombined(calc.parse('2026-10-13T08:00'), calc.parse('2026-10-13T16:00'), W);
    eq(p.length, 1);
    eq(p[0].type, 'regular');
  });
  test('Fr 12:45 – Sa 10:00: BD 20:00–09:30, Übergabe 9:30–10:00', () => {
    const r = calc.calculate([shift('2026-10-09T12:45', '2026-10-10T10:00', 'combined')], S(W), '2026-10');
    eq(r.regularHours, 7.75);
    eq(r.bdHours, 13.5);
  });
  test('Sa 9:30 – So 9:30: BD 10:00–09:00 = 23 h, je 0,5 h Übergabe', () => {
    const r = calc.calculate([shift('2026-10-17T09:30', '2026-10-18T09:30', 'combined')], S(W), '2026-10');
    eq(r.bdHours, 23);
    eq(r.balance.bdCredited, 13.8);
    eq(r.regularHours, 1);
    eq(row(r, 'sunday', 25).hours, 0.5); // So 9:00–9:30
  });
  test('So 9:00 – Mo 9:00: BD 09:30–08:00 = 22,5 h, Montag ist belegt', () => {
    const r = calc.calculate([shift('2026-10-18T09:00', '2026-10-19T09:00', 'combined')], S(W), '2026-10');
    eq(r.bdHours, 22.5);
    eq(r.balance.bdCredited, 13.5);
    eq(r.regularHours, 1.5);           // So 9:00–9:30, Mo 8:00–9:00
    eq(r.balance.autoDays, 21);
    eq(r.balance.saldo, 7);            // 13,5 + 1,5 − 8 (Montag)
    eq(row(r, 'bdPayout').amount, 233.17); // 7 × 33,31
  });
  test('Feiertag am Samstag (03.10.) gilt als Sonn-/Feiertag', () => {
    const [from, to] = calc.bdWindow(calc.parse('2026-10-03T09:00'), S(W));
    eq(hm(from), '2026-10-03T09:30');
    eq(hm(to), '2026-10-04T09:00');
  });
  test('Nacht vor einem Feiertag: BD endet 9:00 (24./25.12.)', () => {
    const [from, to] = calc.bdWindow(calc.parse('2026-12-24T12:45'), S(W));
    eq(hm(from), '2026-12-24T20:00');
    eq(hm(to), '2026-12-25T09:00');
  });
  test('Vorbelegte Dienstzeiten je Tagesart', () => {
    const d = (date) => { const t = calc.defaultTimes(date, S(W)); return t.start + ' ' + t.end; };
    eq(d('2026-10-13'), '2026-10-13T12:45 2026-10-14T09:00'); // Di
    eq(d('2026-10-09'), '2026-10-09T12:45 2026-10-10T10:00'); // Fr
    eq(d('2026-10-17'), '2026-10-17T09:30 2026-10-18T09:30'); // Sa
    eq(d('2026-10-18'), '2026-10-18T09:00 2026-10-19T09:00'); // So
    eq(d('2026-12-24'), '2026-12-24T12:45 2026-12-25T09:30'); // vor Feiertag
    eq(d('2026-10-03'), '2026-10-03T09:00 2026-10-04T09:30'); // Feiertag (Sa)
  });

  // --- Arbeitszeitkonto ----------------------------------------------------------
  test('Soll: Oktober 2026 = 22 Werktage × 8 h, Juni 2026 NW ohne Fronleichnam', () => {
    const oct = calc.calculate([], S(), '2026-10');
    eq(oct.balance.workdays, 22);
    eq(oct.balance.target, 176);
    eq(oct.balance.saldo, 0);
    eq(oct.total, 0);
    eq(calc.calculate([], S(), '2026-06').balance.target, 168);
  });
  test('Soll bei 42-h-Tabelle: Oktober 2025 = 22 × 8,4 h', () => {
    eq(calc.calculate([], S(), '2025-10').balance.target, 184.8);
  });
  test('Nur Werktags-Nacht: Saldo −0,55 h, keine Auszahlung', () => {
    const r = calc.calculate([shift('2026-10-13T12:45', '2026-10-14T09:00', 'combined')], S(W), '2026-10');
    eq(r.balance.autoHours, 160);
    eq(r.balance.credited, 175.45);    // 160 + 8,25 + 7,2
    eq(r.balance.saldo, -0.55);
    eq(r.balance.payoutHours, 0);
    eq(row(r, 'bdPayout').hours, 0);
  });
  test('Werktags-Nacht + Samstagsdienst: Saldo +14,25 h → 474,67 €', () => {
    const r = calc.calculate([
      shift('2026-10-13T12:45', '2026-10-14T09:00', 'combined'),
      shift('2026-10-17T09:30', '2026-10-18T09:30', 'combined'),
    ], S(W), '2026-10');
    eq(r.balance.credited, 190.25);
    eq(r.balance.saldo, 14.25);
    eq(row(r, 'bdPayout').amount, 474.67); // 14,25 × 33,31
  });
  test('Frei-Tag am Mittwoch: Saldo −8 h', () => {
    const r = calc.calculate([shift('2026-10-21T00:00', '2026-10-22T00:00', 'off')], S(), '2026-10');
    eq(r.balance.autoDays, 21);
    eq(r.balance.saldo, -8);
    eq(r.regularHours, 0);
  });
  test('Nachtdienst ab 30.09. belegt den 01.10. (prevShifts)', () => {
    const prev = [shift('2026-09-30T12:45', '2026-10-01T09:00', 'combined')];
    eq(calc.calculate([], S(), '2026-10', prev).balance.saldo, -8);
    eq(calc.calculate([], S(), '2026-10').balance.saldo, 0);
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

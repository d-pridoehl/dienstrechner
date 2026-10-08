// Entgelttabellen und datumsabhängige Regeln aus dem TV-Ärzte (TdL), Stand 9. ÄndTV.
// Quelle: input/tarifvertrag.pdf, Anlagen A 1 bis B 2.
(function (root) {
  'use strict';

  // Monatsbeträge in Euro, Index 0 = Stufe 1. Tabellen sind nach "gültig ab" sortiert.
  const TABLES = [
    {
      name: 'Anlage A 1', from: '2023-10-01', weeklyHours: 42,
      groups: {
        'Ä1': [5104.24, 5393.56, 5600.21, 5958.42, 6385.47, 6552.04],
        'Ä2': [6736.78, 7301.63, 7797.59, 8076.29, 8228.22, 8438.20],
        'Ä3': [8438.20, 8934.16, 9643.64],
        'Ä4': [9926.10, 10635.56, 11200.40],
      },
    },
    {
      name: 'Anlage A 2', from: '2024-04-01', weeklyHours: 42,
      groups: {
        'Ä1': [5308.41, 5609.30, 5824.22, 6196.76, 6640.89, 6814.12],
        'Ä2': [7006.25, 7593.70, 8109.49, 8399.34, 8557.35, 8775.73],
        'Ä3': [8775.73, 9291.53, 10029.39],
        'Ä4': [10323.14, 11060.98, 11648.42],
      },
    },
    {
      name: 'Anlage B 1', from: '2025-02-01', weeklyHours: 42,
      groups: {
        'Ä1': [5626.91, 5945.86, 6173.67, 6568.57, 7039.34, 7222.97],
        'Ä2': [7426.63, 8049.32, 8596.06, 8903.30, 9070.79, 9302.27],
        'Ä3': [9302.27, 9849.02, 10631.15],
        'Ä4': [10942.53, 11724.64, 12347.33],
      },
    },
    {
      // Ab 2026 gleiche Beträge, aber 40 statt 42 Wochenstunden (§ 6 Abs. 1).
      name: 'Anlage B 2', from: '2026-01-01', weeklyHours: 40,
      groups: {
        'Ä1': [5626.91, 5945.86, 6173.67, 6568.57, 7039.34, 7222.97],
        'Ä2': [7426.63, 8049.32, 8596.06, 8903.30, 9070.79, 9302.27],
        'Ä3': [9302.27, 9849.02, 10631.15, 10942.53],
        'Ä4': [10942.53, 11724.64, 12347.33],
      },
    },
    {
      // Tarifabschluss 2026, gültig 01.04.2026 – 31.08.2027. Nicht im PDF enthalten; Quelle:
      // https://oeffentlicher-dienst.info/c/t/rechner/aerzte/uniklinik?id=tv-aerzte-2026&matrix=1
      // Dort ist für Ä3 keine Stufe 4 mehr aufgeführt.
      name: 'Entgelttabelle 2026', from: '2026-04-01', weeklyHours: 40,
      groups: {
        'Ä1': [5792.90, 6121.26, 6355.79, 6762.34, 7247.00, 7436.05],
        'Ä2': [7645.72, 8286.77, 8849.64, 9165.95, 9338.38, 9576.69],
        'Ä3': [9576.69, 10139.57, 10944.77],
        'Ä4': [11265.33, 12070.52, 12711.58],
      },
    },
  ];

  // Ab 1. April 2024: Nachtarbeit 20–6 Uhr statt 21–6 Uhr (§ 7 Abs. 7, § 9 Abs. 3),
  // Samstagszuschlag 13–20 Uhr statt 13–21 Uhr (§ 8 Abs. 1 Buchst. f).
  const NIGHT_RULE_CHANGE = '2024-04-01';

  // § 24 Abs. 4: auf volle Cent runden, Zwischenrechnungen auf zwei Dezimalstellen.
  function round2(x) {
    return Math.round((x + 1e-9) * 100) / 100;
  }

  // date: 'YYYY-MM-DD'
  function tableFor(date) {
    let found = null;
    for (const t of TABLES) if (t.from <= date) found = t;
    if (!found) throw new Error('Keine Entgelttabelle für ' + date + ' (frühestens ' + TABLES[0].from + ')');
    return found;
  }

  // Gruppen mit weniger Stufen (Ä3, Ä4) bleiben auf ihrer höchsten Stufe.
  function monthlySalary(date, group, stufe) {
    const values = tableFor(date).groups[group];
    if (!values) throw new Error('Unbekannte Entgeltgruppe ' + group);
    return values[Math.min(stufe, values.length) - 1];
  }

  // § 24 Abs. 3: Monatsbetrag / (4,348 × regelmäßige Wochenarbeitszeit).
  function hourlyRate(date, group, stufe) {
    return round2(monthlySalary(date, group, stufe) / (4.348 * tableFor(date).weeklyHours));
  }

  function nightStartHour(date) {
    return date >= NIGHT_RULE_CHANGE ? 20 : 21;
  }

  function saturdayEndHour(date) {
    return date >= NIGHT_RULE_CHANGE ? 20 : 21;
  }

  const api = { TABLES, round2, tableFor, monthlySalary, hourlyRate, nightStartHour, saturdayEndHour };
  root.DR = root.DR || {};
  root.DR.tariff = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

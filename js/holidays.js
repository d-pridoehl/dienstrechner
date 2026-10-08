// Gesetzliche Feiertage je Bundesland. Regionale Feiertage, die nur in Teilen eines Landes
// gelten (Augsburger Friedensfest, Mariä Himmelfahrt in Teilen Bayerns, Fronleichnam in Teilen
// Sachsens/Thüringens), werden nicht berücksichtigt.
(function (root) {
  'use strict';

  const STATES = {
    BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen',
    HH: 'Hamburg', HE: 'Hessen', MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen',
    NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen',
    ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen',
  };

  const DAY = 86400000;

  function fmt(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  // Ostersonntag nach dem anonymen gregorianischen Algorithmus (Meeus/Jones/Butcher).
  function easter(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return fmt(Date.UTC(year, month - 1, day));
  }

  // Buß- und Bettag: Mittwoch vor dem 23. November.
  function bussUndBettag(year) {
    const nov22 = Date.UTC(year, 10, 22);
    const back = (new Date(nov22).getUTCDay() - 3 + 7) % 7;
    return fmt(nov22 - back * DAY);
  }

  const cache = {};

  // Liefert { 'YYYY-MM-DD': 'Name', ... } für ein Jahr und Bundesland.
  function holidays(year, state) {
    const key = year + state;
    if (cache[key]) return cache[key];
    const e = Date.parse(easter(year) + 'T00:00:00Z');
    const rel = (days) => fmt(e + days * DAY);
    const fix = (mmdd) => year + '-' + mmdd;
    const inS = (...states) => states.includes(state);
    const list = [
      [fix('01-01'), 'Neujahr', true],
      [fix('01-06'), 'Heilige Drei Könige', inS('BW', 'BY', 'ST')],
      [fix('03-08'), 'Internationaler Frauentag', (inS('BE') && year >= 2019) || (inS('MV') && year >= 2023)],
      [rel(-2), 'Karfreitag', true],
      [rel(0), 'Ostersonntag', inS('BB', 'HE')],
      [rel(1), 'Ostermontag', true],
      [fix('05-01'), 'Tag der Arbeit', true],
      [fix('05-08'), '80. Jahrestag der Befreiung', inS('BE') && year === 2025],
      [rel(39), 'Christi Himmelfahrt', true],
      [rel(49), 'Pfingstsonntag', inS('BB', 'HE')],
      [rel(50), 'Pfingstmontag', true],
      [rel(60), 'Fronleichnam', inS('BW', 'BY', 'HE', 'NW', 'RP', 'SL')],
      [fix('08-15'), 'Mariä Himmelfahrt', inS('SL')],
      [fix('09-20'), 'Weltkindertag', inS('TH') && year >= 2019],
      [fix('10-03'), 'Tag der Deutschen Einheit', true],
      [fix('10-31'), 'Reformationstag', inS('BB', 'MV', 'SN', 'ST', 'TH') || (inS('HB', 'HH', 'NI', 'SH') && year >= 2018)],
      [fix('11-01'), 'Allerheiligen', inS('BW', 'BY', 'NW', 'RP', 'SL')],
      [bussUndBettag(year), 'Buß- und Bettag', inS('SN')],
      [fix('12-25'), '1. Weihnachtsfeiertag', true],
      [fix('12-26'), '2. Weihnachtsfeiertag', true],
    ];
    const result = {};
    for (const [date, name, applies] of list) if (applies) result[date] = name;
    cache[key] = result;
    return result;
  }

  // date: 'YYYY-MM-DD' → Name des Feiertags oder null
  function holidayName(date, state) {
    return holidays(Number(date.slice(0, 4)), state)[date] || null;
  }

  const api = { STATES, easter, bussUndBettag, holidays, holidayName };
  root.DR = root.DR || {};
  root.DR.holidays = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

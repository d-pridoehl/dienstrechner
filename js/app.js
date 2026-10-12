// Oberfläche: Einstellungen, Dienst-Tabelle, Ergebnis. Daten bleiben im localStorage des Browsers.
(function () {
  'use strict';

  const { calc, holidays } = window.DR;
  const $ = (id) => document.getElementById(id);
  const HOUR = 3600000;
  const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  const num = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const DEFAULT_SETTINGS = {
    group: 'Ä1', stufe: 1, bdStufe: 'I', state: 'NW', holidayFreizeitausgleich: true,
    bdStart: calc.DEFAULT_BD_START, bdEnd: calc.DEFAULT_BD_END,
  };

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* privater Modus o. Ä. */ }
  }

  function currentMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function previousMonth(m) {
    const [y, mo] = m.split('-').map(Number);
    return mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0');
  }

  function fmtLocal(ms) {
    return new Date(ms).toISOString().slice(0, 16);
  }

  let settings = Object.assign({}, DEFAULT_SETTINGS, load('dr:settings', {}));
  // Bis v0.2 war 07:00 der Standard für das BD-Ende; seit v0.3 ist es 08:00 (1 h Übergabe werktags).
  if (!settings.v) {
    if (settings.bdEnd === '07:00') settings.bdEnd = calc.DEFAULT_BD_END;
    settings.v = 3;
  }
  let month = load('dr:month', null) || currentMonth();
  let shifts = load('dr:' + month, []);

  // --- Einstellungen -----------------------------------------------------------

  function fillSelects() {
    for (const [code, name] of Object.entries(holidays.STATES)) {
      $('state').add(new Option(name, code));
    }
    for (let s = 1; s <= 6; s++) $('stufe').add(new Option('Stufe ' + s, String(s)));
    for (const id of ['bdStartH', 'bdEndH']) HOURS.forEach((h) => $(id).add(new Option(h, h)));
    for (const id of ['bdStartM', 'bdEndM']) MINUTES.forEach((m) => $(id).add(new Option(m, m)));
  }

  function showSettings() {
    $('month').value = month;
    $('group').value = settings.group;
    $('stufe').value = String(settings.stufe);
    $('bdStufe').value = settings.bdStufe;
    $('state').value = settings.state;
    $('holidayFza').value = settings.holidayFreizeitausgleich ? '1' : '0';
    setTime($('bdStartH'), $('bdStartM'), settings.bdStart);
    setTime($('bdEndH'), $('bdEndM'), settings.bdEnd);
  }

  function readSettings() {
    settings = {
      group: $('group').value,
      stufe: Number($('stufe').value),
      bdStufe: $('bdStufe').value,
      state: $('state').value,
      holidayFreizeitausgleich: $('holidayFza').value === '1',
      bdStart: $('bdStartH').value + ':' + $('bdStartM').value,
      bdEnd: $('bdEndH').value + ':' + $('bdEndM').value,
      v: 3,
    };
    save('dr:settings', settings);
    renderInfo();
    renderResult();
  }

  // --- Dienst-Tabelle ----------------------------------------------------------

  function saveShifts() {
    save('dr:' + month, shifts);
  }

  function shiftInfo(s) {
    const a = calc.parse(s.start), b = calc.parse(s.end);
    if (isNaN(a) || isNaN(b) || b <= a) return '';
    const days = [];
    for (let t = Math.floor(a / 86400000) * 86400000; t < b; t += 86400000) {
      const date = fmtLocal(t).slice(0, 10);
      const name = holidays.holidayName(date, settings.state);
      days.push(WEEKDAYS[new Date(t).getUTCDay()] + (name ? ' (' + name + ')' : ''));
    }
    if (s.type === 'off') return { text: 'Frei · ' + days.join(', '), summary: [] };
    let text = num.format((b - a) / HOUR) + ' h · ' + days.join(' → ');
    const pieces = s.type === 'combined' ? calc.splitCombined(a, b, settings) : [{ start: a, end: b, type: s.type }];
    if (s.type === 'combined') {
      const hm = (ms) => fmtLocal(ms).slice(11);
      text += ' · ' + pieces.map((p) => (p.type === 'bd' ? 'BD ' : 'Regel ') + hm(p.start) + '–' + hm(p.end)).join(', ');
    }
    // Zusammenfassung je Dienst: Stunden Regelarbeit und Bereitschaftsdienst
    const sum = (type) => pieces.filter((p) => p.type === type).reduce((h, p) => h + (p.end - p.start) / HOUR, 0);
    return { text, summary: [`Regelarbeit: ${num.format(sum('regular'))} h`, `BD: ${num.format(sum('bd'))} h`] };
  }

  const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
  const MINUTES = ['00', '15', '30', '45'];

  // Uhrzeit als zwei Auswahllisten (24-h-Format, 15-Minuten-Raster), unabhängig von der Browsersprache.
  function timeSelects(part) {
    return '<span class="clock">'
      + `<select class="hh" data-part="${part}H" aria-label="Stunde">${HOURS.map((h) => `<option>${h}</option>`).join('')}</select>`
      + '<span class="colon">:</span>'
      + `<select class="mm" data-part="${part}M" aria-label="Minute">${MINUTES.map((m) => `<option>${m}</option>`).join('')}</select>`
      + '</span>';
  }

  // Werte außerhalb des Rasters (z. B. aus älteren Einträgen) werden als Option ergänzt statt verworfen.
  function setSelect(sel, value) {
    if (![...sel.options].some((o) => o.value === value)) sel.add(new Option(value, value));
    sel.value = value;
  }

  function setTime(hSel, mSel, hhmm) {
    setSelect(hSel, hhmm.slice(0, 2));
    setSelect(mSel, hhmm.slice(3, 5));
  }

  function part(tr, name) {
    return tr.querySelector(`[data-part="${name}"]`);
  }

  // Schreibt Datum, Uhrzeiten und Art eines Dienstes in die Eingabefelder der Zeile.
  function showShift(tr, s) {
    for (const f of ['start', 'end']) {
      const v = s[f] || '';
      part(tr, f + 'Date').value = v.slice(0, 10);
      setTime(part(tr, f + 'H'), part(tr, f + 'M'), v.slice(11, 16) || '00:00');
    }
    part(tr, 'type').value = s.type;
  }

  function readTime(tr, f) {
    const date = part(tr, f + 'Date').value;
    return date ? `${date}T${part(tr, f + 'H').value}:${part(tr, f + 'M').value}` : '';
  }

  function renderShifts() {
    const tbody = $('shiftRows');
    tbody.replaceChildren();
    shifts.forEach((s, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="idx" data-label="#">${i + 1}</td>
        <td data-label="Beginn"><div class="dt"><input type="date" data-part="startDate" aria-label="Datum Beginn">${timeSelects('start')}</div></td>
        <td data-label="Ende"><div class="dt"><input type="date" data-part="endDate" aria-label="Datum Ende">${timeSelects('end')}</div></td>
        <td data-label="Art"><select data-part="type">
          <option value="regular">Regelarbeit / Nacht</option>
          <option value="bd">Bereitschaftsdienst</option>
          <option value="combined">Dienst mit Bereitschaft</option>
          <option value="off">Frei (ohne Anrechnung)</option>
        </select></td>
        <td class="info muted" data-label="Info"></td>
        <td><button type="button" class="del" title="Dienst löschen" aria-label="Dienst ${i + 1} löschen">✕</button></td>`;
      showShift(tr, s);
      for (const el of tr.querySelectorAll('[data-part]')) {
        el.addEventListener('change', () => updateShift(i, el.dataset.part, tr));
      }
      tr.querySelector('.del').addEventListener('click', () => {
        shifts.splice(i, 1);
        saveShifts();
        renderShifts();
        renderResult();
      });
      tbody.appendChild(tr);
    });
    $('emptyHint').hidden = shifts.length > 0;
    renderInfo();
  }

  // Vorbelegung ab dem Starttag: Ende immer am Folgetag, Uhrzeiten nach Tagesart (calc.defaultTimes);
  // "Frei" belegt den ganzen Tag.
  function applyDefaults(s, date) {
    if (s.type === 'off') {
      Object.assign(s, { start: date + 'T00:00', end: fmtLocal(calc.parse(date + 'T00:00') + 24 * HOUR) });
    } else {
      Object.assign(s, calc.defaultTimes(date, settings));
    }
  }

  function updateShift(i, name, tr) {
    const s = shifts[i];
    const oldDate = (s.start || '').slice(0, 10);
    s.type = part(tr, 'type').value;
    s.start = readTime(tr, 'start');
    s.end = readTime(tr, 'end');
    const date = s.start.slice(0, 10);
    // Neuer Starttag oder Wechsel auf "Dienst mit Bereitschaft"/"Frei" → Ende und Uhrzeiten vorbelegen.
    // Geänderte Uhrzeiten oder ein geändertes Enddatum bleiben erhalten.
    const newDay = name === 'startDate' && date !== oldDate;
    const newType = name === 'type' && (s.type === 'combined' || s.type === 'off');
    if (date && (newDay || newType)) {
      applyDefaults(s, date);
      showShift(tr, s);
    }
    saveShifts();
    renderInfo();
    renderResult();
  }

  function renderInfo() {
    $('shiftRows').querySelectorAll('tr').forEach((tr, i) => {
      const cell = tr.querySelector('.info');
      const info = shiftInfo(shifts[i]);
      cell.textContent = info ? info.text : '';
      for (const line of info ? info.summary : []) {
        const div = document.createElement('div');
        div.className = 'summary';
        div.textContent = line;
        cell.appendChild(div);
      }
    });
  }

  // Neuer Dienst: am Tag nach dem letzten Dienst (sonst am Monatsersten) mit gleicher Art,
  // Zeiten nach Tagesart vorbelegt.
  function addShift() {
    const last = shifts[shifts.length - 1];
    let date = month + '-01', type = 'combined';
    if (last && !isNaN(calc.parse(last.start))) {
      date = fmtLocal(calc.parse(last.start.slice(0, 10) + 'T00:00') + 24 * HOUR).slice(0, 10);
      type = last.type;
    }
    const s = { type };
    applyDefaults(s, date);
    shifts.push(s);
    saveShifts();
    renderShifts();
    renderResult();
    const inputs = $('shiftRows').querySelectorAll('input[data-part="startDate"]');
    inputs[inputs.length - 1].focus();
  }

  // --- Ergebnis ----------------------------------------------------------------

  function renderResult() {
    let r;
    try {
      r = calc.calculate(shifts, settings, month, load('dr:' + previousMonth(month), []));
    } catch (e) {
      $('warnings').replaceChildren(li(e.message));
      $('resultRows').replaceChildren();
      $('total').textContent = '';
      $('facts').replaceChildren();
      $('balanceRows').replaceChildren();
      return;
    }

    $('warnings').replaceChildren(...r.warnings.map(li));

    const rows = r.rows.map((row) => {
      const tr = document.createElement('tr');
      tr.className = row.cat.startsWith('bd') ? 'bd' : '';
      tr.innerHTML = `<td></td><td class="muted"></td><td class="num">${num.format(row.hours)}</td>
        <td class="num">${num.format(row.rate)}</td><td class="num">${row.percent} %</td>
        <td class="num">${eur.format(row.hourly)}</td><td class="num">${eur.format(row.amount)}</td>`;
      // §, Satz und Stundensatz stehen auf schmalen Bildschirmen unter der Kategorie statt in eigenen Spalten.
      tr.cells[0].textContent = row.label;
      const para = document.createElement('span');
      para.className = 'para';
      para.textContent = `${row.para} · ${row.percent} % × ${num.format(row.rate)} € = ${eur.format(row.hourly)}/h`;
      tr.cells[0].appendChild(para);
      tr.cells[1].textContent = row.para;
      return tr;
    });
    if (!rows.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="7" class="muted">Keine zuschlagspflichtigen Stunden.</td>';
      rows.push(tr);
    }
    $('resultRows').replaceChildren(...rows);
    $('total').textContent = eur.format(r.total);

    const facts = [
      ['Tabellenentgelt ' + settings.group + ' Stufe ' + settings.stufe, eur.format(r.baseSalary) + ' (' + r.table + ')'],
      ['Stundenentgelt Stufe 3 (Zuschläge)', eur.format(r.rateStufe3)],
      ['Individuelles Stundenentgelt (Zeitüberhang)', eur.format(r.rateIndividual)],
      ['Gezählte Bereitschaftsdienste (§ 7 Abs. 5a)', String(r.bdCount).replace('.', ',')],
    ];
    renderBalance(r.balance);
    $('facts').replaceChildren(...facts.flatMap(([k, v]) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      return [dt, dd];
    }));
  }

  function renderBalance(b) {
    const h = (x) => num.format(x) + ' h';
    const daily = b.workdays ? b.target / b.workdays : 0;
    const lines = [
      ['Soll', `${b.workdays} Werktage × ${h(daily)}`, h(b.target), 'sum'],
      ['Standardtage ohne Eintrag', `${b.autoDays} × ${h(daily)}`, h(b.autoHours)],
      ['Regelarbeit (eingetragen)', '', h(b.regularHours)],
      ...b.bdCredit.map((c) => [`Bereitschaftsdienst (${c.label})`, `${h(c.hours)} × ${c.rating} %`, h(c.credited)]),
      ['Ist', '', h(b.credited), 'sum'],
      [b.saldo < 0 ? 'Saldo (Minusstunden)' : 'Saldo (wird ausgezahlt)', 'Ist − Soll', (b.saldo > 0 ? '+' : '') + h(b.saldo),
        'sum ' + (b.saldo < 0 ? 'neg' : 'pos')],
    ];
    $('balanceRows').replaceChildren(...lines.map(([label, detail, value, cls]) => {
      const tr = document.createElement('tr');
      tr.className = cls || '';
      tr.innerHTML = '<td></td><td class="muted"></td><td class="num"></td>';
      tr.cells[0].textContent = label;
      tr.cells[1].textContent = detail;
      tr.cells[2].textContent = value;
      return tr;
    }));
  }

  function li(text) {
    const el = document.createElement('li');
    el.textContent = text;
    return el;
  }

  // --- Start -------------------------------------------------------------------

  fillSelects();
  showSettings();
  for (const id of ['group', 'stufe', 'bdStufe', 'bdStartH', 'bdStartM', 'bdEndH', 'bdEndM', 'state', 'holidayFza']) $(id).addEventListener('change', readSettings);
  $('month').addEventListener('change', () => {
    if (!$('month').value) return;
    month = $('month').value;
    save('dr:month', month);
    shifts = load('dr:' + month, []);
    renderShifts();
    renderResult();
  });
  $('addShift').addEventListener('click', addShift);
  renderShifts();
  renderResult();
})();

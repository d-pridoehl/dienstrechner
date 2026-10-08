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

  function fmtLocal(ms) {
    return new Date(ms).toISOString().slice(0, 16);
  }

  let settings = Object.assign({}, DEFAULT_SETTINGS, load('dr:settings', {}));
  let month = load('dr:month', null) || currentMonth();
  let shifts = load('dr:' + month, []);

  // --- Einstellungen -----------------------------------------------------------

  function fillSelects() {
    for (const [code, name] of Object.entries(holidays.STATES)) {
      $('state').add(new Option(name, code));
    }
    for (let s = 1; s <= 6; s++) $('stufe').add(new Option('Stufe ' + s, String(s)));
  }

  function showSettings() {
    $('month').value = month;
    $('group').value = settings.group;
    $('stufe').value = String(settings.stufe);
    $('bdStufe').value = settings.bdStufe;
    $('state').value = settings.state;
    $('holidayFza').value = settings.holidayFreizeitausgleich ? '1' : '0';
    $('bdStart').value = settings.bdStart;
    $('bdEnd').value = settings.bdEnd;
  }

  function readSettings() {
    settings = {
      group: $('group').value,
      stufe: Number($('stufe').value),
      bdStufe: $('bdStufe').value,
      state: $('state').value,
      holidayFreizeitausgleich: $('holidayFza').value === '1',
      bdStart: $('bdStart').value || calc.DEFAULT_BD_START,
      bdEnd: $('bdEnd').value || calc.DEFAULT_BD_END,
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
    let info = num.format((b - a) / HOUR) + ' h · ' + days.join(' → ');
    if (s.type === 'combined') {
      const hm = (ms) => fmtLocal(ms).slice(11);
      info += ' · ' + calc.splitCombined(a, b, settings)
        .map((p) => (p.type === 'bd' ? 'BD ' : 'Regel ') + hm(p.start) + '–' + hm(p.end)).join(', ');
    }
    return info;
  }

  function renderShifts() {
    const tbody = $('shiftRows');
    tbody.replaceChildren();
    shifts.forEach((s, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="idx" data-label="#">${i + 1}</td>
        <td data-label="Beginn"><input type="datetime-local" data-field="start"></td>
        <td data-label="Ende"><input type="datetime-local" data-field="end"></td>
        <td data-label="Art"><select data-field="type">
          <option value="regular">Regelarbeit / Nacht</option>
          <option value="bd">Bereitschaftsdienst</option>
          <option value="combined">Dienst mit Bereitschaft</option>
        </select></td>
        <td class="info muted" data-label="Info"></td>
        <td><button type="button" class="del" title="Dienst löschen" aria-label="Dienst ${i + 1} löschen">✕</button></td>`;
      for (const el of tr.querySelectorAll('[data-field]')) {
        el.value = s[el.dataset.field] || '';
        el.addEventListener('change', () => updateShift(i, el.dataset.field, el.value, tr));
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

  function updateShift(i, field, value, tr) {
    const s = shifts[i];
    s[field] = field === 'type' ? value : value.slice(0, 16);
    // Komfort: Ende fehlt oder liegt vor Beginn → 12 h nach Beginn vorschlagen.
    if (field === 'start' && s.start) {
      const a = calc.parse(s.start), b = calc.parse(s.end);
      if (isNaN(b) || b <= a) {
        s.end = fmtLocal(a + 12 * HOUR);
        tr.querySelector('[data-field="end"]').value = s.end;
      }
    }
    saveShifts();
    renderInfo();
    renderResult();
  }

  function renderInfo() {
    $('shiftRows').querySelectorAll('tr').forEach((tr, i) => {
      tr.querySelector('.info').textContent = shiftInfo(shifts[i]);
    });
  }

  // Neuer Dienst: einen Tag nach dem letzten, gleiche Uhrzeit, Dauer und Art.
  function addShift() {
    const last = shifts[shifts.length - 1];
    let start = calc.parse(month + '-01T20:00'), duration = 12 * HOUR, type = 'regular';
    if (last && !isNaN(calc.parse(last.start))) {
      const a = calc.parse(last.start), b = calc.parse(last.end);
      start = a + 24 * HOUR;
      if (!isNaN(b) && b > a) duration = b - a;
      type = last.type;
    }
    shifts.push({ start: fmtLocal(start), end: fmtLocal(start + duration), type });
    saveShifts();
    renderShifts();
    renderResult();
    const inputs = $('shiftRows').querySelectorAll('input[data-field="start"]');
    inputs[inputs.length - 1].focus();
  }

  // --- Ergebnis ----------------------------------------------------------------

  function renderResult() {
    let r;
    try {
      r = calc.calculate(shifts, settings, month);
    } catch (e) {
      $('warnings').replaceChildren(li(e.message));
      $('resultRows').replaceChildren();
      $('total').textContent = '';
      $('facts').replaceChildren();
      return;
    }

    $('warnings').replaceChildren(...r.warnings.map(li));

    const rows = r.rows.map((row) => {
      const tr = document.createElement('tr');
      tr.className = row.cat.startsWith('bd') ? 'bd' : '';
      tr.innerHTML = `<td></td><td class="muted"></td><td class="num">${num.format(row.hours)}</td>
        <td class="num">${num.format(row.rate)}</td><td class="num">${row.percent} %</td><td class="num">${eur.format(row.amount)}</td>`;
      // § steht auf schmalen Bildschirmen unter der Kategorie statt in eigener Spalte.
      tr.cells[0].textContent = row.label;
      const para = document.createElement('span');
      para.className = 'para';
      para.textContent = row.para;
      tr.cells[0].appendChild(para);
      tr.cells[1].textContent = row.para;
      return tr;
    });
    if (!rows.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="6" class="muted">Keine zuschlagspflichtigen Stunden.</td>';
      rows.push(tr);
    }
    $('resultRows').replaceChildren(...rows);
    $('total').textContent = eur.format(r.total);

    const facts = [
      ['Tabellenentgelt ' + settings.group + ' Stufe ' + settings.stufe, eur.format(r.baseSalary) + ' (' + r.table + ')'],
      ['Stundenentgelt Stufe 3 (Zuschläge)', eur.format(r.rateStufe3)],
      ['Individuelles Stundenentgelt (BD)', eur.format(r.rateIndividual)],
      ['Stunden Regelarbeit / Bereitschaftsdienst', num.format(r.regularHours) + ' h / ' + num.format(r.bdHours) + ' h'],
      ['Gezählte Bereitschaftsdienste (§ 7 Abs. 5a)', String(r.bdCount).replace('.', ',')],
    ];
    $('facts').replaceChildren(...facts.flatMap(([k, v]) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      return [dt, dd];
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
  for (const id of ['group', 'stufe', 'bdStufe', 'bdStart', 'bdEnd', 'state', 'holidayFza']) $(id).addEventListener('change', readSettings);
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

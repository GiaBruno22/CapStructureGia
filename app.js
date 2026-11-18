// app.js - reads the CSV files in data/, runs the math in capstruct.js and
// draws the tables. Every figure comes from data/; nothing is typed in here.
(function () {
  'use strict';
  const C = window.CapStruct;

  // ---------- Formatting (round half up on the decimal value) ----------
  function fmt(x, d) {
    const r = C.round(x, d);
    return (r === 0 ? 0 : r).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const dollars = x => (x < 0 ? '−$' + fmt(-x, 0) : '$' + fmt(x, 0));
  const paren = x => (C.round(x, 0) === 0 ? '(0)' : '(' + fmt(x, 0) + ')');
  const cents = x => (x < 0 ? '−$' + fmt(-x, 2) : '$' + fmt(x, 2));
  const pct = x => (x === null ? '—' : fmt(x * 100, 2) + '%');
  const mult = x => (x === null ? 'n/a' : fmt(x, 2) + '×');
  const shares = x => fmt(x, 2);

  const el = (tag, attrs, html) => {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  async function getCSV(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not read ' + path + ' (' + res.status + ')');
    return C.parseCSV(await res.text());
  }

  // ---------- Firm U and Firm L ----------
  function firmTableHTML(name, f) {
    const y = f.years;
    const row = (label, cells, cls) =>
      '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>';
    const span = (label, val, cls) =>
      '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td><td colspan="3" style="text-align:center">' + val + '</td></tr>';
    return '<table><caption>' + name + (f.debt > 0 ? ' (debt ' + dollars(f.debt) + ' at ' + pct(f.rate) + ')' : ' (no debt)') + '</caption>' +
      '<tbody>' +
      row('Assets', y.map(() => dollars(f.assets))) +
      row('Equity', y.map(() => dollars(f.equity))) +
      row('Probability', y.map(r => fmt(r.probability, 2))) +
      row('Sales', y.map(r => dollars(r.sales)), 'sep') +
      row('Oper. costs', y.map(r => paren(r.operatingCosts))) +
      row('EBIT', y.map(r => dollars(r.ebit))) +
      row('Interest', y.map(r => paren(r.interest))) +
      row('EBT', y.map(r => dollars(r.ebt))) +
      row('Taxes (' + pct(f.tax).replace('.00', '') + ')', y.map(r => paren(r.taxes))) +
      row('Net income', y.map(r => dollars(r.netIncome))) +
      row('ROE', y.map(r => pct(r.roe)), 'sep') +
      row('TIE', y.map(r => mult(r.tie))) +
      span('E(ROE)', pct(f.eRoe), 'sep') +
      span('σ(ROE)', pct(f.sdRoe)) +
      span('CV of ROE', f.cvRoe === null ? 'n/a' : fmt(f.cvRoe, 2)) +
      span('E(TIE)', mult(f.eTie)) +
      span('σ(TIE)', mult(f.sdTie)) +
      '</tbody></table>';
  }

  // ---------- CDSS ----------
  function cdssTableHTML(rows, cols, bestIndex) {
    const head = '<thead><tr>' + cols.map(c => '<th>' + c.label + '</th>').join('') + '</tr></thead>';
    const body = rows.map((r, i) =>
      '<tr' + (i === bestIndex ? ' class="best"' : '') + '>' +
      cols.map(c => '<td data-label="' + (c.plain || c.label) + '">' + c.get(r) + '</td>').join('') + '</tr>').join('');
    return '<table class="stack">' + head + '<tbody>' + body + '</tbody></table>';
  }

  function bestNote(res) {
    const d = i => (i < 0 ? 'n/a' : dollars(res.rows[i].debt));
    const b = res.best;
    const lines = [
      'Highest share price, case method: <strong>' + d(b.priceCase) + '</strong> of debt.',
      'Highest share price, new-price method: <strong>' + d(b.priceNew) + '</strong>.',
      'Lowest WACC, book weights: <strong>' + d(b.waccBook) + '</strong>.',
      'Lowest WACC, market weights: <strong>' + d(b.waccMarket) + '</strong>.'
    ];
    const all = [b.priceCase, b.priceNew, b.waccBook, b.waccMarket];
    const agree = all.every(i => i === all[0]);
    lines.push(agree
      ? 'All four point to the same amount of debt.'
      : 'They don\'t all point to the same amount of debt, so look at each one rather than picking a single answer.');
    return lines.join('<br>') + '<br><span class="explain">Shaded rows have the highest share price for that method.</span>';
  }

  // ---------- Main ----------
  async function main() {
    const status = document.getElementById('status');
    try {
      const [cdssRows, assumptions, schedRows, firmRows, scenRows] = await Promise.all([
        getCSV('data/cdss.csv'),
        getCSV('data/assumptions.csv'),
        getCSV('data/banker_schedule.csv'),
        getCSV('data/example_firms.csv'),
        getCSV('data/ebit_scenarios.csv')
      ]);

      const cdss = C.toLookup(cdssRows, 'item', 'value');
      const tax = C.toLookup(assumptions, 'assumption', 'value').tax_rate;
      const firms = C.toLookup(firmRows, 'item', 'value');
      const scenarios = scenRows.map(r => ({
        probability: C.num(r.probability), sales: C.num(r.sales), operating_costs: C.num(r.operating_costs)
      }));
      const schedule = C.readSchedule(schedRows);

      // Firm U and Firm L
      const u = C.firmTable(firms.total_assets, 0, firms.interest_rate, tax, scenarios); u.tax = tax;
      const l = C.firmTable(firms.total_assets, firms.firm_l_debt, firms.interest_rate, tax, scenarios); l.tax = tax;
      document.getElementById('firm-u').innerHTML = firmTableHTML('Firm U', u);
      document.getElementById('firm-l').innerHTML = firmTableHTML('Firm L', l);

      // CDSS
      const res = C.cdssAll(cdss, tax, schedule);
      document.getElementById('cdss-facts').innerHTML =
        'EBIT = ' + dollars(cdss.sales) + ' × (1 − ' + pct(cdss.variable_cost_rate) + ') − ' + dollars(cdss.fixed_costs) +
        ' = <strong>' + dollars(res.ebit) + '</strong> at every amount of debt. ' +
        fmt(cdss.shares_outstanding, 0) + ' shares at ' + cents(cdss.share_price) + ' today, tax rate ' + pct(tax) +
        ', book assets ' + dollars(cdss.total_assets) + '. All earnings are paid out, so dividends per share = EPS and g = 0.';

      const common = [
        { label: 'Debt', get: r => dollars(r.debt) },
        { label: 'r<sub>d</sub>', plain: 'Cost of debt r_d', get: r => pct(r.rd) },
        { label: 'r<sub>s</sub>', plain: 'Cost of equity r_s', get: r => pct(r.rs) }
      ];
      document.getElementById('cdss-case').innerHTML = cdssTableHTML(res.rows, common.concat([
        { label: 'Net income', get: r => dollars(r.netIncome) },
        { label: 'Shares repurchased', get: r => shares(r.caseMethod.repurchased) },
        { label: 'Shares remaining', get: r => shares(r.caseMethod.remaining) },
        { label: 'EPS', get: r => cents(r.caseMethod.eps) },
        { label: 'TIE', get: r => mult(r.tie) },
        { label: 'Share price', get: r => cents(r.caseMethod.price) },
        { label: 'WACC (book)', get: r => pct(r.caseMethod.wacc) }
      ]), res.best.priceCase);

      document.getElementById('cdss-new').innerHTML = cdssTableHTML(res.rows, common.concat([
        { label: 'Value of equity S', get: r => dollars(r.newPrice.equityValue) },
        { label: 'Value of firm V', get: r => dollars(r.newPrice.firmValue) },
        { label: 'Share price', get: r => cents(r.newPrice.price) },
        { label: 'Shares repurchased', get: r => shares(r.newPrice.repurchased) },
        { label: 'Shares remaining', get: r => shares(r.newPrice.remaining) },
        { label: 'EPS', get: r => cents(r.newPrice.eps) },
        { label: 'TIE', get: r => mult(r.tie) },
        { label: 'WACC (market)', get: r => pct(r.newPrice.wacc) }
      ]), res.best.priceNew);

      document.getElementById('cdss-best').innerHTML = bestNote(res);

      const w = document.getElementById('warnings');
      res.warnings.forEach(msg => w.appendChild(el('div', { class: 'warn' }, '<strong>Check failed:</strong> ' + msg)));

      status.remove();
    } catch (err) {
      status.className = 'warn';
      status.textContent = 'The app could not load its data: ' + err.message +
        '. If you opened index.html straight from your computer, the browser blocks reading the data files; open the published GitHub Pages address instead.';
    }
  }

  main();
})();

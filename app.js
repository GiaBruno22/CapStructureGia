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
  function cdssTableHTML(rows, cols, bestIndex, currentIndex) {
    const head = '<thead><tr>' + cols.map(c => '<th>' + c.label + '</th>').join('') + '</tr></thead>';
    const body = rows.map((r, i) => {
      const cls = [i === bestIndex ? 'best' : '', i === currentIndex ? 'current' : ''].filter(Boolean).join(' ');
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' +
      cols.map(c => '<td data-label="' + (c.plain || c.label) + '">' + c.get(r) + '</td>').join('') + '</tr>';
    }).join('');
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

  // ---------- Levers ----------
  // Firm U next to Firm L at the slider's debt
  function firmCompareHTML(u, l) {
    const probs = u.years.map(y => fmt(y.probability, 2));
    const r = (label, a, b, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td><td>' + a + '</td><td>' + b + '</td></tr>';
    let h = '<table class="compare"><caption>Firm U next to Firm L at ' + dollars(l.debt) + ' of debt</caption>' +
      '<thead><tr><th></th><th>Firm U</th><th>Firm L</th></tr></thead><tbody>';
    u.years.forEach((y, i) => { h += r('ROE, EBIT ' + dollars(y.ebit) + ' (p = ' + probs[i] + ')', pct(y.roe), pct(l.years[i].roe), i === 0 ? '' : ''); });
    u.years.forEach((y, i) => { h += r('TIE, EBIT ' + dollars(y.ebit) + ' (p = ' + probs[i] + ')', mult(y.tie), mult(l.years[i].tie), i === 0 ? 'sep' : ''); });
    h += r('E(ROE)', pct(u.eRoe), pct(l.eRoe), 'sep');
    h += r('σ(ROE)', pct(u.sdRoe), pct(l.sdRoe));
    h += r('CV of ROE', u.cvRoe === null ? 'n/a' : fmt(u.cvRoe, 2), l.cvRoe === null ? 'n/a' : fmt(l.cvRoe, 2));
    h += r('E(TIE)', mult(u.eTie), mult(l.eTie), 'sep');
    h += r('σ(TIE)', mult(u.sdTie), mult(l.sdTie));
    return h + '</tbody></table>';
  }

  function stakeText(st) {
    if (st.status === 'all') return '100.00%*';
    if (st.status === 'sell') return 'Management would have to sell';
    return pct(st.stake);
  }

  // Both buyback methods at the slider's debt
  function cdssLeverHTML(row, cdss) {
    const a = row.caseMethod, b = row.newPrice, n = cdss.shares_outstanding, m = cdss.management_share;
    const sa = C.mgmtStake(m, n, a.repurchased), sb = C.mgmtStake(m, n, b.repurchased);
    const r = (label, x, y, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td><td>' + x + '</td><td>' + y + '</td></tr>';
    let h = '<table class="compare"><caption>CDSS with ' + dollars(row.debt) + ' of debt' +
      (row.rd === null ? '' : ' (r<sub>d</sub> ' + pct(row.rd) + ', ') + (row.rd === null ? ' (' : '') + 'r<sub>s</sub> ' + pct(row.rs) + ')</caption>' +
      '<thead><tr><th></th><th>Case method: buy back at ' + cents(cdss.share_price) + '</th><th>New-price method</th></tr></thead><tbody>' +
      r('Share price', cents(a.price), cents(b.price)) +
      r('Shares repurchased', shares(a.repurchased), shares(b.repurchased)) +
      r('Shares remaining', shares(a.remaining), shares(b.remaining)) +
      r('EPS', cents(a.eps), cents(b.eps), 'sep') +
      r('Dividends per share', cents(a.dps), cents(b.dps)) +
      r('TIE', mult(row.tie), mult(row.tie)) +
      r('WACC', pct(a.wacc) + ' (book weights)', pct(b.wacc) + ' (market weights)', 'sep') +
      r("Management's share of the company", stakeText(sa), stakeText(sb)) +
      '</tbody></table>';
    const notes = [];
    [['case method', sa], ['new-price method', sb]].forEach(([name, st]) => {
      if (st.status === 'all') notes.push('*Under the ' + name + ', the buyback takes every outside share, so management would own 100% and no outside shareholders would be left.');
      if (st.status === 'sell') notes.push('<strong>Warning:</strong> under the ' + name + ', the buyback needs more shares than outside investors own, so management would have to sell some of its own.');
    });
    if (notes.length) h += '<div class="note">' + notes.join('<br>') + '</div>';
    return h;
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
      document.getElementById('firm-u').innerHTML = firmTableHTML('Firm U', u);
      document.getElementById('firmL-rate').textContent = pct(firms.interest_rate);

      const fs = document.getElementById('firmL-slider');
      fs.min = 0; fs.max = firms.slider_max; fs.step = firms.slider_step; fs.value = firms.firm_l_debt;
      function drawFirmL() {
        const debt = Number(fs.value);
        const l = C.firmTable(firms.total_assets, debt, firms.interest_rate, tax, scenarios); l.tax = tax;
        document.getElementById('firmL-value').textContent = dollars(debt);
        document.getElementById('firm-l').innerHTML = firmTableHTML('Firm L', l);
        document.getElementById('firm-compare').innerHTML = firmCompareHTML(u, l);
      }
      fs.addEventListener('input', drawFirmL);
      document.getElementById('btn-case').addEventListener('click', () => { fs.value = firms.firm_l_debt; drawFirmL(); });
      drawFirmL();

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
      const caseCols = common.concat([
        { label: 'Net income', get: r => dollars(r.netIncome) },
        { label: 'Shares repurchased', get: r => shares(r.caseMethod.repurchased) },
        { label: 'Shares remaining', get: r => shares(r.caseMethod.remaining) },
        { label: 'EPS', get: r => cents(r.caseMethod.eps) },
        { label: 'TIE', get: r => mult(r.tie) },
        { label: 'Share price', get: r => cents(r.caseMethod.price) },
        { label: 'WACC (book)', get: r => pct(r.caseMethod.wacc) }
      ]);

      const newCols = common.concat([
        { label: 'Value of equity S', get: r => dollars(r.newPrice.equityValue) },
        { label: 'Value of firm V', get: r => dollars(r.newPrice.firmValue) },
        { label: 'Share price', get: r => cents(r.newPrice.price) },
        { label: 'Shares repurchased', get: r => shares(r.newPrice.repurchased) },
        { label: 'Shares remaining', get: r => shares(r.newPrice.remaining) },
        { label: 'EPS', get: r => cents(r.newPrice.eps) },
        { label: 'TIE', get: r => mult(r.tie) },
        { label: 'WACC (market)', get: r => pct(r.newPrice.wacc) }
      ]);

      const ds = document.getElementById('debt-slider');
      ds.min = 0; ds.max = res.rows.length - 1; ds.step = 1;
      ds.value = Math.max(0, res.rows.findIndex(r => r.debt === cdss.debt));
      const pickNote = document.getElementById('pick-note');
      function drawCdss() {
        const i = Number(ds.value), row = res.rows[i];
        document.getElementById('debt-value').textContent = dollars(row.debt);
        document.getElementById('cdss-lever').innerHTML = cdssLeverHTML(row, cdss);
        document.getElementById('cdss-case').innerHTML = cdssTableHTML(res.rows, caseCols, res.best.priceCase, i);
        document.getElementById('cdss-new').innerHTML = cdssTableHTML(res.rows, newCols, res.best.priceNew, i);
      }
      function jump(what, caseIdx, newIdx) {
        const t = C.pickTarget(caseIdx, newIdx);
        ds.value = t.index;
        pickNote.innerHTML = t.agree
          ? what + ': both buyback methods pick ' + dollars(res.rows[t.index].debt) + ' of debt.'
          : what + ': the case method picks ' + dollars(res.rows[t.caseIdx].debt) + ' and the new-price method picks ' +
            dollars(res.rows[t.newIdx].debt) + '. The slider is at the case method\'s amount.';
        drawCdss();
      }
      ds.addEventListener('input', () => { pickNote.innerHTML = ''; drawCdss(); });
      document.getElementById('btn-best-price').addEventListener('click', () => jump('Best price', res.best.priceCase, res.best.priceNew));
      document.getElementById('btn-best-eps').addEventListener('click', () => jump('Highest EPS', res.best.epsCase, res.best.epsNew));
      drawCdss();

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

  // Progressive web app: register the service worker (relative path, so it
  // works at https://<username>.github.io/<repository>/).
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered:', err));
    });
  }
})();

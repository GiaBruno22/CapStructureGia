// capstruct.js - the finance math for the AGE capital structure app.
// Plain functions only: nothing here touches the page, so every number
// can be checked with Node, e.g.
//   node -e "const c=require('./capstruct.js'); console.log(c.round(0.14025*100,2))"
(function (root) {
  'use strict';

  // ---------- CSV ----------
  // Turns CSV text into an array of objects keyed by the header row.
  // Handles quoted fields; blank cells come back as ''.
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    const src = String(text).replace(/^﻿/, '');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(f => f.trim() !== '')) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(f => f.trim() !== '')) rows.push(row);
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => {
      const o = {};
      head.forEach((h, j) => { o[h] = (r[j] === undefined ? '' : r[j].trim()); });
      return o;
    });
  }

  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    const x = Number(v);
    if (!Number.isFinite(x)) throw new Error('Not a number: "' + v + '"');
    return x;
  }

  // item,value CSVs (cdss.csv, assumptions.csv, example_firms.csv) -> {item: number}
  function toLookup(rows, keyCol, valCol) {
    const o = {};
    rows.forEach(r => { o[r[keyCol]] = num(r[valCol]); });
    return o;
  }

  // ---------- Rounding ----------
  // Round half up on the decimal value. toFixed rounds the binary value and
  // gets 14.025 -> 14.02 and 3.495 -> 3.49 wrong; this gets 14.03 and 3.50.
  function round(x, d) {
    const f = Math.pow(10, d);
    const scaled = Number((x * f).toPrecision(12));
    return Math.sign(scaled) * Math.round(Math.abs(scaled)) / f;
  }

  // ---------- Statistics ----------
  function expected(probs, xs) {
    return probs.reduce((s, p, i) => s + p * xs[i], 0);
  }
  function stdev(probs, xs) {
    const m = expected(probs, xs);
    return Math.sqrt(probs.reduce((s, p, i) => s + p * Math.pow(xs[i] - m, 2), 0));
  }

  // ---------- Firm U and Firm L (question c) ----------
  // scenarios: [{probability, sales, operating_costs}]
  function firmTable(assets, debt, rate, tax, scenarios) {
    const equity = assets - debt;
    const interest = rate * debt;
    const years = scenarios.map(s => {
      const ebit = s.sales - s.operating_costs;
      const ebt = ebit - interest;
      const taxes = tax * ebt;
      const ni = ebt - taxes;
      return {
        probability: s.probability, sales: s.sales, operatingCosts: s.operating_costs,
        ebit, interest, ebt, taxes, netIncome: ni,
        roe: ni / equity,
        tie: interest > 0 ? ebit / interest : null
      };
    });
    const p = years.map(y => y.probability);
    const roe = years.map(y => y.roe);
    const eRoe = expected(p, roe), sRoe = stdev(p, roe);
    let eTie = null, sTie = null;
    if (interest > 0) {
      const tie = years.map(y => y.tie);
      eTie = expected(p, tie); sTie = stdev(p, tie);
    }
    return {
      assets, debt, equity, rate, interest, years,
      eRoe, sdRoe: sRoe, cvRoe: eRoe !== 0 ? sRoe / eRoe : null,
      eTie, sdTie: sTie
    };
  }

  // ---------- CDSS ----------
  function cdssEbit(c) {
    return c.sales * (1 - c.variable_cost_rate) - c.fixed_costs;
  }

  // One row of the banker's schedule, both buyback methods.
  // c: lookup from cdss.csv; tax: tax rate; row: {debt, rd, rs}
  function cdssAtDebt(c, tax, row) {
    const D = row.debt, rd = row.rd || 0, rs = row.rs;
    const n = c.shares_outstanding, P0 = c.share_price, A = c.total_assets;
    const ebit = cdssEbit(c);
    const interest = rd * D;
    const ni = (ebit - interest) * (1 - tax);
    const tie = interest > 0 ? ebit / interest : null;

    // Case method: buy back at today's $20
    const repCase = D / P0;
    const remCase = n - repCase;
    const epsCase = ni / remCase;
    const caseM = {
      repurchased: repCase, remaining: remCase, eps: epsCase, dps: epsCase,
      price: epsCase / rs,
      // Book weights (AGE solution, d(7))
      wacc: (D / A) * rd * (1 - tax) + ((A - D) / A) * rs
    };

    // New-price method: buy back at the price after the announcement
    const S = ni / rs;
    const V = S + D;
    const P = V / n;
    const repNew = D / P;
    const remNew = n - repNew;
    const epsNew = ni / remNew;
    const waccMkt = (D / V) * rd * (1 - tax) + (S / V) * rs;
    const newM = {
      equityValue: S, firmValue: V, price: P,
      repurchased: repNew, remaining: remNew, eps: epsNew, dps: epsNew,
      wacc: waccMkt,
      checkEps: Math.abs(epsNew - rs * P) < 1e-9 * Math.max(1, epsNew),
      checkWacc: Math.abs(waccMkt - ebit * (1 - tax) / V) < 1e-12
    };

    return { debt: D, rd: row.rd, rs, ebit, interest, netIncome: ni, tie, caseMethod: caseM, newPrice: newM };
  }

  // schedule rows from banker_schedule.csv -> [{debt, rd, rs}], sorted by debt
  function readSchedule(rows) {
    return rows.map(r => ({ debt: num(r.debt), rd: num(r.cost_of_debt), rs: num(r.cost_of_equity) }))
      .sort((a, b) => a.debt - b.debt);
  }

  // Index of the best row; ties go to the smaller amount of debt (earlier row).
  function argBest(rows, get, better) {
    let best = -1;
    rows.forEach((r, i) => {
      const v = get(r);
      if (v === null || !Number.isFinite(v)) return;
      if (best < 0 || better(v, get(rows[best]))) best = i;
    });
    return best;
  }
  const higher = (a, b) => a > b + 1e-12;
  const lower = (a, b) => a < b - 1e-12;

  function cdssAll(c, tax, schedule) {
    const rows = schedule.map(r => cdssAtDebt(c, tax, r));
    const warnings = [];
    const zero = rows.find(r => r.debt === 0);
    if (!zero) warnings.push('The schedule has no $0 row, so the app cannot check today\'s price.');
    else if (Math.abs(zero.caseMethod.price - c.share_price) > 0.005) {
      warnings.push('At $0 of debt, EPS / r_s = $' + round(zero.caseMethod.price, 2).toFixed(2) +
        ', which does not equal today\'s share price of $' + round(c.share_price, 2).toFixed(2) + '.');
    }
    rows.forEach(r => {
      if (!r.newPrice.checkEps) warnings.push('New-price check failed at $' + r.debt + ': EPS does not equal r_s × P.');
      if (!r.newPrice.checkWacc) warnings.push('New-price check failed at $' + r.debt + ': WACC does not equal EBIT(1 − T) / V.');
    });
    return {
      ebit: cdssEbit(c),
      rows,
      best: {
        priceCase: argBest(rows, r => r.caseMethod.price, higher),
        priceNew: argBest(rows, r => r.newPrice.price, higher),
        epsCase: argBest(rows, r => r.caseMethod.eps, higher),
        epsNew: argBest(rows, r => r.newPrice.eps, higher),
        waccBook: argBest(rows, r => r.caseMethod.wacc, lower),
        waccMarket: argBest(rows, r => r.newPrice.wacc, lower)
      },
      warnings
    };
  }

  const api = { parseCSV, num, toLookup, round, expected, stdev, firmTable, cdssEbit, cdssAtDebt, readSchedule, cdssAll, argBest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CapStruct = api;
})(typeof self !== 'undefined' ? self : this);

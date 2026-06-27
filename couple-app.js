// ============================================================
// 2026/27 HMRC constants
// ============================================================
const PA_STANDARD   = 12570;   // Personal Allowance (per person)
const PA_TAPER_START= 100000;  // PA taper starts
const PA_TAPER_END  = 125140;  // PA fully gone
const BASIC_TOP     = 50270;   // higher rate threshold
const ADDL_TOP      = 125140;  // additional rate threshold
const BASIC_RATE    = 0.20;
const HIGHER_RATE   = 0.40;
const ADDL_RATE     = 0.45;

const fmt = (n) => {
  const sign = n < 0 ? '-' : '';
  n = Math.abs(Math.round(n));
  return sign + '£' + n.toLocaleString('en-GB');
};
const fmt1 = (n) => '£' + Math.round(n).toLocaleString('en-GB');

// ============================================================
// Personal Allowance with taper (applies per person, individually)
// ============================================================
function personalAllowance(totalIncome){
  if(totalIncome <= PA_TAPER_START) return PA_STANDARD;
  if(totalIncome >= PA_TAPER_END) return 0;
  const reduction = Math.floor((totalIncome - PA_TAPER_START) / 2);
  return Math.max(0, PA_STANDARD - reduction);
}

function incomeTaxOnTaxable(taxableIncome){
  let tax = 0;
  let remaining = taxableIncome;
  const basicBand = BASIC_TOP - PA_STANDARD;
  const higherBand = ADDL_TOP - BASIC_TOP;

  const basicAmt = Math.min(remaining, basicBand);
  tax += basicAmt * BASIC_RATE;
  remaining -= basicAmt;

  if(remaining > 0){
    const higherAmt = Math.min(remaining, higherBand);
    tax += higherAmt * HIGHER_RATE;
    remaining -= higherAmt;
  }
  if(remaining > 0){
    tax += remaining * ADDL_RATE;
  }
  return tax;
}

function incomeTaxFromGross(grossIncome){
  const pa = personalAllowance(grossIncome);
  const taxable = Math.max(0, grossIncome - pa);
  return incomeTaxOnTaxable(taxable);
}

// ============================================================
// Per-person, per-year withdrawal logic.
// Given this person's current bucket balances, their state pension for
// the year, the strategy, and how much cash THEY personally need to find
// this year, decide how much comes from each of their four buckets.
// Pure function — does not mutate balances, just returns the draw amounts.
// ============================================================
function computeYearDraw(balances, statePension, need, strategy){
  const { isa, penFree, penTax, other } = balances;
  let dISA = 0, dPenFree = 0, dPenTax = 0, dOther = 0;

  if(need > 0){
    if(strategy === 'isa-first'){
      dISA = Math.min(isa, need); need -= dISA;
      if(need > 0){ dPenFree = Math.min(penFree, need); need -= dPenFree; }
      if(need > 0){ dPenTax = Math.min(penTax, need); need -= dPenTax; }
    }
    else if(strategy === 'pension-first'){
      dPenFree = Math.min(penFree, need); need -= dPenFree;
      if(need > 0){ dPenTax = Math.min(penTax, need); need -= dPenTax; }
      if(need > 0){ dISA = Math.min(isa, need); need -= dISA; }
    }
    else if(strategy === 'even'){
      let pots = [];
      if(isa > 0) pots.push('isa');
      if(penFree > 0) pots.push('penFree');
      if(penTax > 0) pots.push('penTax');
      if(pots.length > 0){
        let share = need / pots.length;
        if(pots.includes('isa')){ dISA = Math.min(isa, share); }
        if(pots.includes('penFree')){ dPenFree = Math.min(penFree, share); }
        if(pots.includes('penTax')){ dPenTax = Math.min(penTax, share); }
        let drawn = dISA + dPenFree + dPenTax;
        need -= drawn;
        if(need > 0.5){ let e = Math.min(isa-dISA, need); dISA += e; need -= e; }
        if(need > 0.5){ let e = Math.min(penFree-dPenFree, need); dPenFree += e; need -= e; }
        if(need > 0.5){ let e = Math.min(penTax-dPenTax, need); dPenTax += e; need -= e; }
      }
    }
    else if(strategy === 'pa-then-even'){
      const paHeadroom = Math.max(0, PA_STANDARD - statePension);
      if(paHeadroom > 0){
        dPenTax = Math.min(penTax, need, paHeadroom);
        need -= dPenTax;
      }
      if(need > 0){
        let pots = [];
        if(isa > 0) pots.push('isa');
        if(penFree > 0) pots.push('penFree');
        if(pots.length > 0){
          let share = need / pots.length;
          let exI = 0, exP = 0;
          if(pots.includes('isa')) exI = Math.min(isa, share);
          if(pots.includes('penFree')) exP = Math.min(penFree, share);
          dISA += exI; dPenFree += exP; need -= (exI+exP);
          if(need > 0.5){ let e = Math.min(isa-dISA, need); dISA += e; need -= e; }
          if(need > 0.5){ let e = Math.min(penFree-dPenFree, need); dPenFree += e; need -= e; }
        }
      }
      if(need > 0 && penTax-dPenTax > 0){
        const more = Math.min(penTax-dPenTax, need);
        dPenTax += more; need -= more;
      }
    }
    else if(strategy === 'myidea'){
      const paHeadroom = Math.max(0, PA_STANDARD - statePension);
      if(paHeadroom > 0){
        dPenTax = Math.min(penTax, need, paHeadroom);
        need -= dPenTax;
      }
      if(need > 0){
        const fromPenFree = Math.min(penFree, need);
        dPenFree += fromPenFree; need -= fromPenFree;
      }
      if(need > 0){
        const fromISA = Math.min(isa, need);
        dISA += fromISA; need -= fromISA;
      }
      if(need > 0 && penTax-dPenTax > 0){
        const more = Math.min(penTax-dPenTax, need);
        dPenTax += more; need -= more;
      }
    }
    else {
      // ---- "smart" tax-minimising strategy ----
      const paHeadroom = Math.max(0, PA_STANDARD - statePension);
      dPenFree = Math.min(penFree, need);
      need -= dPenFree;
      if(need > 0 && paHeadroom > 0){
        const fillPA = Math.min(penTax, need, paHeadroom);
        dPenTax += fillPA; need -= fillPA;
      }
      if(need > 0){
        const fromISA = Math.min(isa, need);
        dISA += fromISA; need -= fromISA;
      }
      if(need > 0 && penTax-dPenTax > 0){
        const more = Math.min(penTax-dPenTax, need);
        dPenTax += more; need -= more;
      }
      if(need > 0 && penFree-dPenFree > 0){
        const more = Math.min(penFree-dPenFree, need);
        dPenFree += more; need -= more;
      }
    }
  }

  // ---- Universal last-resort rule ----
  // "Other taxable investments" only ever touched once ISA, tax-free cash
  // and taxable pension are all fully depleted, regardless of strategy.
  if(need > 0 && other > 0){
    dOther = Math.min(other, need);
    need -= dOther;
  }

  // ---- Universal "use the Personal Allowance" overwrite rule ----
  // If this person's year would otherwise land at £0 tax, but state pension
  // + taxable pension drawdown don't add up to their own full Personal
  // Allowance, swap money back out of ISA/tax-free cash/other into taxable
  // pension instead, up to the PA limit. Never changes total withdrawal.
  {
    const paGapBeforeOverwrite = PA_STANDARD - (statePension + dPenTax);
    if(paGapBeforeOverwrite > 0.5){
      let extraFromPenTax = Math.min(paGapBeforeOverwrite, penTax - dPenTax);
      if(extraFromPenTax > 0.5){
        let toReclaim = extraFromPenTax;
        const fromISA = Math.min(dISA, toReclaim);
        dISA -= fromISA; toReclaim -= fromISA;
        const fromPenFree = Math.min(dPenFree, toReclaim);
        dPenFree -= fromPenFree; toReclaim -= fromPenFree;
        const fromOther = Math.min(dOther, toReclaim);
        dOther -= fromOther; toReclaim -= fromOther;
        const actuallySwapped = extraFromPenTax - toReclaim;
        dPenTax += actuallySwapped;
      }
    }
  }

  const shortfall = Math.max(0, need);
  return { dISA, dPenFree, dPenTax, dOther, shortfall };
}

// ============================================================
// Read inputs — one block per person, plus shared household fields
// ============================================================
function readPerson(prefix){
  return {
    age: +document.getElementById(prefix+'Age').value,
    hasState: document.getElementById(prefix+'HasState').checked,
    spa: +document.getElementById(prefix+'Spa').value,
    stateAmt: +document.getElementById(prefix+'StateAmt').value,
    isaBal: +document.getElementById(prefix+'IsaBal').value,
    isaGrowth: +document.getElementById(prefix+'IsaGrowth').value / 100,
    penFreeBal: +document.getElementById(prefix+'PenFreeBal').value,
    penFreeGrowth: +document.getElementById(prefix+'PenFreeGrowth').value / 100,
    penTaxBal: +document.getElementById(prefix+'PenTaxBal').value,
    penTaxGrowth: +document.getElementById(prefix+'PenTaxGrowth').value / 100,
    otherBal: +document.getElementById(prefix+'OtherBal').value,
    otherGrowth: +document.getElementById(prefix+'OtherGrowth').value / 100
  };
}

function readInputs(){
  return {
    planAge: +document.getElementById('planage').value, // years modelled, anchored to Partner A's age
    spend: +document.getElementById('spend').value,
    inflation: +document.getElementById('inflation').value / 100,
    strategy: document.getElementById('strategy').value,
    a: readPerson('a'),
    b: readPerson('b')
  };
}

// ============================================================
// Couple simulation
// Timeline is anchored to Partner A's age. Partner B's age each year is
// derived from the age gap between them (B.age - A.age, fixed over time).
// Household spending need inflates once, is split 50/50, and each partner
// runs the SAME strategy independently across their own four buckets and
// their own Personal Allowance.
// ============================================================
function simulateCouple(inputs){
  const { planAge, spend, inflation, strategy, a, b } = inputs;
  const ageGap = b.age - a.age; // B's age minus A's age, can be negative

  let balA = { isa:a.isaBal, penFree:a.penFreeBal, penTax:a.penTaxBal, other:a.otherBal };
  let balB = { isa:b.isaBal, penFree:b.penFreeBal, penTax:b.penTaxBal, other:b.otherBal };

  const years = [];
  let totalTaxPaid = 0;
  let depletionAge = null; // Partner A's age when the COMBINED household first can't cover spending
  let currentSpend = spend;

  for(let ageA = a.age; ageA <= planAge; ageA++){
    const ageB = ageA + ageGap;

    const stateA = (a.hasState && ageA >= a.spa) ? a.stateAmt : 0;
    const stateB = (b.hasState && ageB >= b.spa) ? b.stateAmt : 0;

    // Household spending need this year, split evenly between the two people
    const householdNeed = currentSpend;
    const halfNeed = householdNeed / 2;

    const needA = Math.max(0, halfNeed - stateA);
    const needB = Math.max(0, halfNeed - stateB);

    let drawA = computeYearDraw(balA, stateA, needA, strategy);
    let drawB = computeYearDraw(balB, stateB, needB, strategy);

    // ---- Rebalancing step ----
    // If one partner's own buckets can't cover their half of spending, but
    // the OTHER partner still has spare capacity, let the partner with money
    // cover the shortfall — this is what a real couple would actually do,
    // rather than mechanically declaring "household out of money" just
    // because the split happened to be uneven that year. The covering
    // partner draws the extra amount via their own strategy (so it still
    // respects their own PA-fill and bucket-priority rules), against their
    // balances net of what they've already drawn this year. If BOTH
    // partners are short at once, neither has spare capacity to lend, so no
    // rebalancing is possible — the true household shortfall is just the
    // sum of what each of them individually couldn't find.
    if(drawA.shortfall > 0.5 && drawB.shortfall < 0.5){
      const remainingBalB = {
        isa: balB.isa - drawB.dISA,
        penFree: balB.penFree - drawB.dPenFree,
        penTax: balB.penTax - drawB.dPenTax,
        other: balB.other - drawB.dOther
      };
      const coverDraw = computeYearDraw(remainingBalB, stateB, drawA.shortfall, strategy);
      drawB = {
        dISA: drawB.dISA + coverDraw.dISA,
        dPenFree: drawB.dPenFree + coverDraw.dPenFree,
        dPenTax: drawB.dPenTax + coverDraw.dPenTax,
        dOther: drawB.dOther + coverDraw.dOther,
        shortfall: 0
      };
      // A's own gap was covered by B's spare capacity; any amount B still
      // couldn't find is the true remaining household shortfall — report it
      // once, on A, so it isn't double-counted in the household total.
      drawA = { ...drawA, shortfall: coverDraw.shortfall };
    }
    else if(drawB.shortfall > 0.5 && drawA.shortfall < 0.5){
      const remainingBalA = {
        isa: balA.isa - drawA.dISA,
        penFree: balA.penFree - drawA.dPenFree,
        penTax: balA.penTax - drawA.dPenTax,
        other: balA.other - drawA.dOther
      };
      const coverDraw = computeYearDraw(remainingBalA, stateA, drawB.shortfall, strategy);
      drawA = {
        dISA: drawA.dISA + coverDraw.dISA,
        dPenFree: drawA.dPenFree + coverDraw.dPenFree,
        dPenTax: drawA.dPenTax + coverDraw.dPenTax,
        dOther: drawA.dOther + coverDraw.dOther,
        shortfall: 0
      };
      drawB = { ...drawB, shortfall: coverDraw.shortfall };
    }
    // else: both already fine (no shortfall), or both short simultaneously —
    // in the both-short case, each draw object already carries its own
    // correct shortfall from computeYearDraw, and they're simply summed
    // below with no further adjustment needed.

    // Apply withdrawals
    balA.isa -= drawA.dISA; balA.penFree -= drawA.dPenFree; balA.penTax -= drawA.dPenTax; balA.other -= drawA.dOther;
    balB.isa -= drawB.dISA; balB.penFree -= drawB.dPenFree; balB.penTax -= drawB.dPenTax; balB.other -= drawB.dOther;

    // Tax calculated separately per person — this is the actual point of a
    // couple having two Personal Allowances instead of one.
    const grossTaxableA = stateA + drawA.dPenTax + drawA.dOther;
    const grossTaxableB = stateB + drawB.dPenTax + drawB.dOther;
    const taxA = incomeTaxFromGross(grossTaxableA);
    const taxB = incomeTaxFromGross(grossTaxableB);
    const taxTotal = taxA + taxB;
    totalTaxPaid += taxTotal;

    const totalIncomeA = stateA + drawA.dPenFree + drawA.dISA + drawA.dPenTax + drawA.dOther;
    const totalIncomeB = stateB + drawB.dPenFree + drawB.dISA + drawB.dPenTax + drawB.dOther;
    const householdShortfall = drawA.shortfall + drawB.shortfall;

    if(householdShortfall > 1 && depletionAge === null){
      depletionAge = ageA;
    }

    // Growth applied at year end, per person's own bucket rates — applied
    // BEFORE the snapshot below, so "balance" in the ledger correctly means
    // the balance after this year's withdrawal AND this year's growth, i.e.
    // what's actually available to draw from at the start of next year.
    balA.isa *= (1+a.isaGrowth); balA.penFree *= (1+a.penFreeGrowth); balA.penTax *= (1+a.penTaxGrowth); balA.other *= (1+a.otherGrowth);
    balB.isa *= (1+b.isaGrowth); balB.penFree *= (1+b.penFreeGrowth); balB.penTax *= (1+b.penTaxGrowth); balB.other *= (1+b.otherGrowth);

    years.push({
      ageA, ageB,
      spendNeed: householdNeed,
      stateA, stateB,
      drawA, drawB,
      taxA, taxB, taxTotal,
      totalIncomeA, totalIncomeB,
      totalIncome: totalIncomeA + totalIncomeB,
      shortfall: householdShortfall,
      balA: { ...balA }, balB: { ...balB }
    });

    currentSpend *= (1+inflation);
  }

  return { years, totalTaxPaid, depletionAge };
}

// ============================================================
// Rendering
// ============================================================
const strategyNotes = {
  smart: "Each partner fills their own Personal Allowance with taxable pension income (using tax-free cash and state pension first), then tops up from their ISA — minimising combined household tax across the whole retirement.",
  'pa-then-even': "Each partner draws taxable pension up to their own remaining Personal Allowance first, then splits any further need equally between their ISA and tax-free cash.",
  myidea: "Each partner fills their own Personal Allowance from taxable pension first, then drains their tax-free cash completely, then their ISA completely, before falling back to further taxable pension.",
  'isa-first': "Each partner drains their own ISA before touching their pension — with each partner's Personal Allowance still topped up from taxable pension if a year would otherwise be £0 tax.",
  'pension-first': "Each partner draws down their own pension (tax-free cash, then taxable) before their ISA.",
  even: "Each partner splits their share of spending evenly across whichever of their own buckets still have a balance."
};

function render(){
  const inputs = readInputs();

  document.getElementById('v-spend').textContent = fmt1(inputs.spend);
  document.getElementById('v-inflation').textContent = (inputs.inflation*100).toFixed(1).replace(/\.0$/,'') + '%';
  document.getElementById('v-planage').textContent = inputs.planAge;
  document.getElementById('strategyNote').textContent = strategyNotes[inputs.strategy];

  ['a','b'].forEach(p => {
    const person = inputs[p];
    document.getElementById('v-'+p+'Age').textContent = person.age;
    document.getElementById('v-'+p+'Spa').textContent = person.spa;
    document.getElementById('v-'+p+'StateAmt').textContent = fmt1(person.stateAmt);
    document.getElementById('v-'+p+'IsaGrowth').textContent = (person.isaGrowth*100).toFixed(1).replace(/\.0$/,'') + '%';
    document.getElementById('v-'+p+'PenFreeGrowth').textContent = (person.penFreeGrowth*100).toFixed(1).replace(/\.0$/,'') + '%';
    document.getElementById('v-'+p+'PenTaxGrowth').textContent = (person.penTaxGrowth*100).toFixed(1).replace(/\.0$/,'') + '%';
    document.getElementById('v-'+p+'OtherGrowth').textContent = (person.otherGrowth*100).toFixed(1).replace(/\.0$/,'') + '%';
  });

  if(inputs.planAge <= inputs.a.age){
    document.getElementById('chartBody').innerHTML = '<p style="padding:20px;color:var(--ink-soft)">Set a plan-to age greater than Partner A\'s current age.</p>';
    return;
  }

  const result = simulateCouple(inputs);
  renderStats(inputs, result);
  renderChart(inputs, result);
  renderTable(result);
}

function renderStats(inputs, result){
  const { years, totalTaxPaid, depletionAge } = result;
  const { a, b } = inputs;
  const totalStartBalance =
    (a.isaBal + a.penFreeBal + a.penTaxBal + a.otherBal) +
    (b.isaBal + b.penFreeBal + b.penTaxBal + b.otherBal);

  const lastYear = years[years.length-1];
  const endingBalance =
    (lastYear.balA.isa + lastYear.balA.penFree + lastYear.balA.penTax + lastYear.balA.other) +
    (lastYear.balB.isa + lastYear.balB.penFree + lastYear.balB.penTax + lastYear.balB.other);

  const totalIncomeAllYears = years.reduce((s,y)=>s+y.totalIncome,0);
  const avgTaxRate = totalIncomeAllYears > 0 ? totalTaxPaid / totalIncomeAllYears * 100 : 0;

  const warningEl = document.getElementById('depletionWarning');
  if(depletionAge){
    warningEl.classList.add('show');
    warningEl.textContent = `⚠ At this spending rate, all of the household's buckets are projected to run out when Partner A is age ${depletionAge} — ${inputs.planAge - depletionAge} years before your planning horizon ends.`;
  } else {
    warningEl.classList.remove('show');
  }

  const stats = [
    { label:'Combined starting balance', value: fmt(totalStartBalance), sub: `${years.length} years modelled` },
    { label:'Combined income tax paid', value: fmt(totalTaxPaid), sub: `${avgTaxRate.toFixed(1)}% effective rate on household income`, cls: totalTaxPaid > 0 ? 'warn' : 'good' },
    { label: depletionAge ? "Funds last until Partner A is" : 'Projected combined balance at age '+inputs.planAge, value: depletionAge ? depletionAge : fmt(endingBalance), cls: depletionAge ? 'warn' : 'good' },
    { label:'Combined tax using TWO allowances', value: fmt(totalTaxPaid), sub:`vs. a single person's £${PA_STANDARD.toLocaleString('en-GB')} allowance for the same total spending`, cls:'good' }
  ];

  document.getElementById('statRow').innerHTML = stats.map(s => `
    <div class="stat">
      <div class="label">${s.label}</div>
      <div class="number ${s.cls||''}">${s.value}</div>
      ${s.sub ? `<div class="sub">${s.sub}</div>` : ''}
    </div>
  `).join('');
}

function niceStep(maxVal, targetTicks){
  const raw = maxVal / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step;
  if(norm < 1.5) step = 1*mag;
  else if(norm < 3.5) step = 2*mag;
  else if(norm < 7.5) step = 5*mag;
  else step = 10*mag;
  return step;
}

function renderChart(inputs, result){
  const { years } = result;
  const rawMax = Math.max(...years.map(y => y.totalIncome), inputs.spend, 1);
  const step = niceStep(rawMax, 5);
  const maxTotal = Math.ceil(rawMax / step) * step + step;

  const LABEL_W = 88, GAP1 = 12;
  const TRACK_LEFT = LABEL_W + GAP1;

  const thresholds = [
    { val: PA_STANDARD, label: 'PA (each) £12,570' },
    { val: PA_STANDARD*2, label: 'Combined 2×PA £25,140' },
    { val: BASIC_TOP, label: 'Higher rate (each) £50,270' }
  ].filter(t => t.val <= maxTotal);

  const body = document.getElementById('chartBody');
  body.style.position = 'relative';
  body.style.paddingTop = '24px';

  const rowsHtml = years.map((y) => {
    // Combined segments: state (both), tax-free cash (both), ISA (both), taxable pension (both), other (both)
    const segs = [];
    const state = y.stateA + y.stateB;
    const penFree = y.drawA.dPenFree + y.drawB.dPenFree;
    const isaAmt = y.drawA.dISA + y.drawB.dISA;
    const penTax = y.drawA.dPenTax + y.drawB.dPenTax;
    const otherAmt = y.drawA.dOther + y.drawB.dOther;

    if(state > 0.5) segs.push({cls:'state', amt:state});
    if(penFree > 0.5) segs.push({cls:'pen-free', amt:penFree});
    if(isaAmt > 0.5) segs.push({cls:'isa', amt:isaAmt});
    if(penTax > 0.5) segs.push({cls:'pen-tax', amt:penTax});
    if(otherAmt > 0.5) segs.push({cls:'other-tax', amt:otherAmt});

    const segHtml = segs.map(s => {
      const w = (s.amt / maxTotal) * 100;
      return `<div class="seg ${s.cls}" style="width:${w}%"></div>`;
    }).join('');

    const depletedHtml = y.shortfall > 1
      ? `<div class="seg depleted" style="width:${(y.shortfall/maxTotal)*100}%"></div>`
      : '';

    const tipData = encodeURIComponent(JSON.stringify({
      ageA:y.ageA, ageB:y.ageB,
      state, penFree, isa:isaAmt, penTax, other:otherAmt,
      total:y.totalIncome, tax:y.taxTotal, taxA:y.taxA, taxB:y.taxB, shortfall:y.shortfall
    }));

    return `
      <div class="bar-row" data-tip="${tipData}">
        <div class="yr-label">${y.ageA}/${y.ageB}<span class="age-tax">${y.taxTotal > 0 ? fmt1(y.taxTotal)+' tax' : 'no tax'}</span></div>
        <div class="bar-track">${segHtml}${depletedHtml}</div>
        <div class="total tabular">${fmt1(y.totalIncome)}</div>
      </div>
    `;
  }).join('');

  body.innerHTML = rowsHtml;

  const tooltip = document.getElementById('chartTooltip');
  const wrap = document.querySelector('.chart-wrap');
  body.querySelectorAll('.bar-row').forEach(row => {
    row.addEventListener('mouseenter', () => {
      const d = JSON.parse(decodeURIComponent(row.dataset.tip));
      let rows = '';
      if(d.state > 0.5) rows += `<div class="tt-row"><span><span class="tt-dot" style="background:var(--state)"></span>State pension</span><span>${fmt1(d.state)}</span></div>`;
      if(d.penFree > 0.5) rows += `<div class="tt-row"><span><span class="tt-dot" style="background:var(--pen-free)"></span>Tax-free cash</span><span>${fmt1(d.penFree)}</span></div>`;
      if(d.isa > 0.5) rows += `<div class="tt-row"><span><span class="tt-dot" style="background:var(--isa)"></span>ISA</span><span>${fmt1(d.isa)}</span></div>`;
      if(d.penTax > 0.5) rows += `<div class="tt-row"><span><span class="tt-dot" style="background:var(--pen-tax)"></span>Pension (taxable)</span><span>${fmt1(d.penTax)}</span></div>`;
      if(d.other > 0.5) rows += `<div class="tt-row"><span><span class="tt-dot" style="background:var(--other)"></span>Other investments</span><span>${fmt1(d.other)}</span></div>`;
      if(d.shortfall > 1) rows += `<div class="tt-row" style="color:#E8B4AE"><span>Shortfall</span><span>${fmt1(d.shortfall)}</span></div>`;
      rows += `<div class="tt-row" style="border-top:1px solid rgba(255,255,255,0.25); margin-top:4px; padding-top:4px;"><span>Partner A tax</span><span>${fmt1(d.taxA)}</span></div>`;
      rows += `<div class="tt-row"><span>Partner B tax</span><span>${fmt1(d.taxB)}</span></div>`;

      tooltip.innerHTML = `<div class="tt-title">A:${d.ageA} / B:${d.ageB} — ${fmt1(d.total)}</div>${rows}`;
      tooltip.style.display = 'block';
    });
    row.addEventListener('mousemove', (e) => {
      const wrapRect = wrap.getBoundingClientRect();
      let left = e.clientX - wrapRect.left + 14;
      let top = e.clientY - wrapRect.top - 10;
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    });
    row.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  });

  requestAnimationFrame(() => {
    const sampleTrack = body.querySelector('.bar-track');
    const overlay = document.getElementById('thresholdOverlay');
    if(!sampleTrack){ overlay.innerHTML = ''; return; }
    const trackWidth = sampleTrack.getBoundingClientRect().width;
    const totalHeight = body.getBoundingClientRect().height;

    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '0';
    overlay.style.pointerEvents = 'none';

    overlay.innerHTML = thresholds.map((t) => {
      const pct = t.val / maxTotal;
      const leftPx = TRACK_LEFT + pct * trackWidth;
      return `<div class="threshold-tick" style="left:${leftPx}px; top:24px; height:${totalHeight-24}px;">
        <span class="tick-label">${t.label}</span>
      </div>`;
    }).join('');
  });
}

function renderTable(result){
  const rows = result.years.map(y => {
    const isaEnd = y.balA.isa + y.balB.isa;
    const penEnd = y.balA.penFree + y.balA.penTax + y.balB.penFree + y.balB.penTax;
    const otherEnd = y.balA.other + y.balB.other;
    const depleted = (isaEnd + penEnd + otherEnd) <= 0.01;
    return `
    <tr class="${depleted ? 'depleted-row' : ''}">
      <td>${y.ageA} / ${y.ageB}</td>
      <td class="tabular">${fmt1(y.spendNeed)}</td>
      <td class="tabular">${fmt1(y.stateA + y.stateB)}</td>
      <td class="tabular">${fmt1(y.drawA.dPenFree + y.drawB.dPenFree)}</td>
      <td class="tabular isa-cell">${fmt1(y.drawA.dISA + y.drawB.dISA)}</td>
      <td class="tabular">${fmt1(y.drawA.dPenTax + y.drawB.dPenTax)}</td>
      <td class="tabular">${fmt1(y.drawA.dOther + y.drawB.dOther)}</td>
      <td class="tabular">${fmt1(y.totalIncome)}</td>
      <td class="tabular ${y.taxA>0?'tax-cell':''}">${fmt1(y.taxA)}</td>
      <td class="tabular ${y.taxB>0?'tax-cell':''}">${fmt1(y.taxB)}</td>
      <td class="tabular ${y.taxTotal>0?'tax-cell':''}">${fmt1(y.taxTotal)}</td>
      <td class="tabular">${fmt1(isaEnd)}</td>
      <td class="tabular">${fmt1(penEnd)}</td>
      <td class="tabular">${fmt1(otherEnd)}</td>
    </tr>
  `;
  }).join('');
  document.getElementById('ledgerBody').innerHTML = rows;
}

// ============================================================
// Wire up events
// ============================================================
const fieldIds = [
  'planage','spend','inflation','strategy',
  'aAge','aHasState','aSpa','aStateAmt','aIsaBal','aIsaGrowth','aPenFreeBal','aPenFreeGrowth','aPenTaxBal','aPenTaxGrowth','aOtherBal','aOtherGrowth',
  'bAge','bHasState','bSpa','bStateAmt','bIsaBal','bIsaGrowth','bPenFreeBal','bPenFreeGrowth','bPenTaxBal','bPenTaxGrowth','bOtherBal','bOtherGrowth'
];
fieldIds.forEach(id => {
  const el = document.getElementById(id);
  if(el) el.addEventListener('input', render);
});

// ---- Person tab switcher ----
document.querySelectorAll('.person-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const person = tab.dataset.person;
    document.querySelectorAll('.person-tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.person-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-'+person));
  });
});

render();

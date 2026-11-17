// Fathom's page, radar-3. It reads window.FATHOM (written beside dashboard/
// by main.ts) and renders the ranked board, the filters, a per-protocol
// detail view with the model's own arithmetic and the protocol's farm plan,
// the size curve, the validation table and the research note. No network:
// every byte it shows is in data.js. The farm plan below is the same
// generator main.ts writes to board.json — family, chains and name in,
// the same five steps out — so the page and the board can never disagree.
(function () {
  'use strict';

  var DATA = window.FATHOM;
  if (!DATA) return;
  var META = DATA.meta;
  var CATS = DATA.categories;
  var NAMES = DATA.names || {};

  // A row is an array: [slug, name, implied, tvl, g7, age, catIdx, chains,
  // multiple, low, high, watchlist, compSlug, compRatio, ...] — three comps.
  function row(slug, name, implied, tvl, g7, age, cat, chains, mult, low, high, wl, comps) {
    return { slug: slug, name: name, implied: implied, tvl: tvl, g7: g7, age: age, cat: cat, chains: chains, mult: mult, low: low, high: high, wl: wl, comps: comps };
  }
  function unpack(a) {
    var comps = [];
    for (var i = 12; i + 1 < a.length; i += 2) comps.push({ slug: a[i], ratio: a[i + 1] });
    return row(a[0], a[1], a[2], a[3], a[4], a[5], a[6] < 0 ? null : CATS[a[6]], a[7], a[8], a[9], a[10], a[11] === 1, comps);
  }
  var ROWS = DATA.rows.map(unpack);
  var BY_SLUG = {};
  ROWS.forEach(function (r) { BY_SLUG[r.slug] = r; });

  var state = { q: '', cat: 'all', chain: 'all', watchOnly: false, sort: 'implied', dir: -1, open: null };

  // ---- formatting ----------------------------------------------------------

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageFmt(y) {
    if (y === null || y === undefined) return 'n/a';
    if (y >= 1) return y.toFixed(1) + 'y';
    return Math.max(1, Math.round(y * 12)) + 'mo';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- the farm plan, mirrored from lib/model.ts ----------------------------

  function familyOf(r) {
    var c = r.cat || '';
    if (c === 'Dexs') return 'dex';
    if (['Lending', 'CDP', 'CDP Manager', 'Collateral Markets', 'Collateral Management', 'Uncollateralized Lending', 'Leveraged Farming'].indexOf(c) >= 0) return 'lending';
    if (['Yield', 'Yield Aggregator', 'Liquidity Manager', 'Basis Trading', 'Options Vault'].indexOf(c) >= 0) return 'yield';
    if (['Bridge', 'Cross Chain Bridge', 'Canonical Bridge'].indexOf(c) >= 0) return 'bridge';
    if (['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Restaked BTC', 'Staking Pool'].indexOf(c) >= 0) return 'stake';
    if (['RWA', 'Onchain Capital Allocator', 'Risk Curators', 'Stablecoin Wrapper', 'Dual-Token Stablecoin', 'Anchor BTC', 'Decentralized BTC', 'Interest Rate Derivatives', 'DOR'].indexOf(c) >= 0) return 'vault';
    if (['Derivatives', 'Options', 'Prediction Market', 'Farm'].indexOf(c) >= 0) return 'deriv';
    if (c === 'Chain') return 'chain';
    return 'use';
  }

  var PLANS = {
    dex: [
      'Open {name} on {chain} with a wallet you use only for farming, and keep $10–$20 of gas on {chain} aside for the first month of activity.',
      'Swap $25–$100 through {name} on {chain} once a week for 4 weeks (about $1–$5 of gas per swap) so the address builds real swap volume.',
      'Add $50–$200 of liquidity to the busiest {name} pool on {chain} and leave it in place for at least 30 days; write down the pool, the range and the entry date.',
      'If {name} also runs on {chain2}, repeat one swap there so your activity spans two chains instead of one; a second chain costs one more gas top-up.',
      'Check the {name} app weekly for quests, points or a leaderboard, and screenshot your positions once a month — a launch, if it ever comes, usually rewards wallets with a history, not a single visit.'
    ],
    lending: [
      'Open {name} on {chain} with a farming-only wallet and deposit $50–$200 of a major stablecoin as supply; keep $10–$20 of gas on {chain} aside.',
      'Borrow $20–$50 against that supply once, then repay it within a week, so the address shows both sides of the market (about $2–$6 of gas per action).',
      'Leave the supply in place for at least 30 days and top it up once mid-month; lenders are usually scored on duration, not on a single deposit.',
      'If {name} runs on {chain2}, repeat the supply on the second chain with a smaller amount so the position is not tied to one network.',
      'Watch the {name} app weekly for a points page or a borrow incentive, and record every deposit and repayment date — a launch snapshot can look back months.'
    ],
    yield: [
      'Open {name} on {chain} with a farming-only wallet and deposit $50–$200 into its largest vault; keep $10–$20 of gas on {chain} aside.',
      'Harvest or compound the position once a week for 4 weeks (about $1–$4 of gas each time) so the address shows repeated use, not one deposit.',
      'Leave the deposit working for at least 30 days; if the vault pays in a points token, claim it at least twice so the claims are on record.',
      'If {name} runs on {chain2}, split a smaller second deposit there so the activity spans two chains and two vaults.',
      'Check the {name} app weekly for new vaults or a leaderboard, and screenshot the position monthly — a launch usually rewards wallets that stayed through a full cycle.'
    ],
    bridge: [
      'Open {name} with a farming-only wallet and bridge $50–$150 from {chain} to {chain2} once; the bridge fee is usually $1–$10 plus gas on both sides.',
      'Bridge back a smaller amount ($25–$75) a week later so the address shows two-way volume instead of a single one-way hop.',
      'Repeat the round trip once a month for 3 months, varying the amount slightly each time; three round trips cost roughly $10–$40 in fees in total.',
      'Use {name} for a real transfer you already need — moving funds to a chain where you trade — instead of bridging back and forth for its own sake.',
      'Keep the transaction hashes and dates in a note; a launch snapshot, if one happens, usually looks for sustained bridging, not one afternoon of hops.'
    ],
    stake: [
      'Open {name} on {chain} with a farming-only wallet and stake $50–$200 of the base asset; keep $10–$20 of gas on {chain} aside for the first month.',
      'Leave the stake untouched for at least 30 days — staking rewards usually score duration — and claim or restake the rewards once mid-month.',
      'If {name} issues a receipt token, use it once in a lending market or a pool on {chain} so the position is active, not idle; one extra transaction, about $2–$5 of gas.',
      'If {name} also runs on {chain2}, stake a smaller amount there so the position spans two chains.',
      'Check the {name} app weekly for a points page, an epoch schedule or a restaking option, and screenshot the stake monthly.'
    ],
    vault: [
      'Open {name} on {chain} with a farming-only wallet and deposit $50–$200 into its largest vault or allocation; keep $10–$20 of gas on {chain} aside.',
      'Leave the deposit in place for at least 30 days and add a second, smaller deposit mid-month; vaults usually score duration and consistency.',
      'Read the vault\'s fee and lock-up terms before depositing and write them down — some vaults charge on exit, and an exit fee can eat a small position.',
      'If {name} runs on {chain2}, repeat a smaller deposit there so the position is not tied to one network.',
      'Check the {name} app weekly for new vaults, a points page or a leaderboard, and screenshot the position monthly for your own records.'
    ],
    deriv: [
      'Open {name} on {chain} with a farming-only wallet and fund it with $50–$150 you can afford to lose; keep $10–$20 of gas on {chain} aside.',
      'Place 2–4 small trades of $10–$25 each over two weeks (about $1–$4 of gas per trade) so the address builds real trading volume.',
      'Use a limit order or a take-profit once, and close at least one position with a profit and one with a small loss — a real trading history, not wash volume.',
      'Leave the account open for at least 30 days and trade once a week; a launch snapshot usually looks for weeks of activity, not a single session.',
      'Check the {name} app weekly for a points page, a trading competition or a fee rebate, and never trade with size you cannot lose.'
    ],
    chain: [
      'Bridge $50–$150 of a major asset onto {name} from {chain} with a farming-only wallet; the bridge fee is usually $1–$10 plus gas.',
      'Use two or three of {name}\'s own apps in the first week — a swap, a lend or a pool — spending $10–$30 per app, so the address is a user of the chain, not a passer-by.',
      'Leave a small balance on {name} for at least 30 days and return once a week to do one real transaction; weekly activity beats one burst.',
      'If {name} has a faucet or a test quest, complete it once and keep the receipt; early-chain quests are often the cheapest signal there is.',
      'Check {name}\'s app hub weekly for new apps or a points page, and screenshot your positions monthly.'
    ],
    use: [
      'Open {name} on {chain} with a farming-only wallet and do the one thing it exists for with $25–$100; keep $10–$20 of gas on {chain} aside.',
      'Repeat that action once a week for 4 weeks (about $1–$5 of gas each time) so the address shows a habit, not a single visit.',
      'Leave any deposit or position in place for at least 30 days; duration is usually what a launch snapshot rewards.',
      'If {name} runs on {chain2}, repeat the same action there once so the activity spans two chains.',
      'Check the {name} app weekly for quests, points or a leaderboard, and screenshot your positions monthly.'
    ]
  };

  function planFor(r) {
    var chain = (r.chains && r.chains[0]) || 'Ethereum';
    var chain2 = (r.chains && r.chains[1]) || chain;
    return PLANS[familyOf(r)].map(function (s) {
      return s.split('{name}').join(r.name).split('{chain2}').join(chain2).split('{chain}').join(chain);
    });
  }

  // ---- the model's arithmetic, recomputed live --------------------------------
  //
  // The detail view recomputes a row from the snapshot figures and the
  // fitted coefficients, so the page's code and the board's data are
  // visibly the same arithmetic. The fitted line lives in META.fit.

  function growthTerm(r) {
    var g = r.g7 === null ? 0 : r.g7;
    return Math.min(50, Math.max(-20, g)) / 100;
  }
  function impliedOf(r) {
    var f = META.fit;
    var logV = f.intercept + f.slopeTvl * Math.log10(r.tvl) + f.coefGrowth * growthTerm(r) + f.coefAge * Math.min(10, r.age);
    return Math.max(1, Math.round(Math.pow(10, logV)));
  }

  // ---- rendering ---------------------------------------------------------------

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function renderMast() {
    var dl = document.getElementById('mastMeta');
    var items = [
      ['Snapshot', META.asOf],
      ['Protocols read', '758'],
      ['Board rows', String(META.rows)],
      ['Watchlist', String(META.watchlist)],
      ['Early rows', String(META.early)],
      ['Launched comps', String(META.launched)]
    ];
    items.forEach(function (kv) {
      dl.appendChild(el('dt', '', esc(kv[0])));
      dl.appendChild(el('dd', '', esc(kv[1])));
    });
  }

  function renderModel() {
    var f = META.fit;
    var v = META.validation[0];
    var sec = document.getElementById('modelPanel');
    sec.innerHTML =
      '<h2>The value model — one fitted line, not a heuristic</h2>' +
      '<p class="eq">log<sub>10</sub>(implied value) = <b>' + f.intercept.toFixed(3) + '</b> + <b>' + f.slopeTvl.toFixed(3) + '</b> · log<sub>10</sub>(TVL) + <b>' + f.coefGrowth.toFixed(3) + '</b> · growth + <b>' + f.coefAge.toFixed(3) + '</b> · age</p>' +
      '<p>Fitted by least squares on the <b>' + f.compsUsed + ' launched tokens</b> in the snapshot (market cap on TVL, growth and age). ' +
      'The slope on TVL is the size curve: below 1, so the market pays a smaller multiple of TVL as protocols get bigger. ' +
      'Growth enters as a spike discount — the fitted coefficient is negative, so a one-week TVL surge is discounted, not rewarded. ' +
      'Age is years since DefiLlama first tracked the protocol with no token; a protocol it never dated gets 2.0 years.</p>' +
      '<div class="pillrow">' +
      '<span class="pill">residual sd <b>' + f.residualSd.toFixed(2) + ' dex</b></span>' +
      '<span class="pill">time-split median error <b>' + v.medianAbsLogErr.toFixed(2) + ' dex</b> (naive ' + v.naiveMedianAbsLogErr.toFixed(2) + ')</span>' +
      '<span class="pill">within 2× <b>' + Math.round(v.withinTwoX * 100) + '%</b></span>' +
      '<span class="pill">within 3× <b>' + Math.round(v.withinThreeX * 100) + '%</b></span>' +
      '</div>';
  }

  function renderControls() {
    var catSel = document.getElementById('cat');
    CATS.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      catSel.appendChild(o);
    });
    var chainSet = {};
    ROWS.forEach(function (r) { (r.chains || []).forEach(function (c) { chainSet[c] = true; }); });
    var chainSel = document.getElementById('chain');
    Object.keys(chainSet).sort().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      chainSel.appendChild(o);
    });
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var list = ROWS.filter(function (r) {
      if (state.watchOnly && !r.wl) return false;
      if (state.cat !== 'all' && r.cat !== state.cat) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    var val = function (r) {
      if (key === 'implied') return r.implied;
      if (key === 'tvl') return r.tvl;
      if (key === 'multiple') return r.mult;
      if (key === 'growth') return r.g7 === null ? 0 : r.g7;
      if (key === 'age') return r.age;
      if (key === 'name') return r.name;
      if (key === 'category') return r.cat || '';
      if (key === 'rank') return -r.implied;
      return r.implied;
    };
    list.sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (typeof va === 'string') return dir * va.localeCompare(vb);
      return dir * (va - vb);
    });
    return list;
  }

  function renderBoard() {
    var list = visibleRows();
    var tbody = document.getElementById('rows');
    tbody.innerHTML = '';
    document.getElementById('empty').hidden = list.length > 0;
    document.getElementById('count').textContent = list.length + ' of ' + ROWS.length + ' rows';
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      if (state.open === r.slug) tr.className = 'open';
      var rank = ROWS.indexOf(r) + 1;
      var gCls = (r.g7 === null || r.g7 === 0) ? '' : (r.g7 > 0 ? 'up' : 'down');
      tr.innerHTML =
        '<td class="num">' + rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span> <span class="slug">' + esc(r.slug) + '</span>' + (r.wl ? ' <span class="wl">WATCHLIST</span>' : '') + '</td>' +
        '<td class="cat">' + esc(r.cat || '—') + '</td>' +
        '<td class="chains">' + esc((r.chains || []).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl) + '</td>' +
        '<td class="num ' + gCls + '">' + pct(r.g7) + '</td>' +
        '<td class="num">' + ageFmt(r.age) + '</td>' +
        '<td class="num">' + r.mult.toFixed(3) + '×</td>' +
        '<td class="num val">' + money(r.implied) + '</td>';
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tbody.appendChild(tr);
    });
    document.querySelectorAll('#board thead th').forEach(function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-sort') === state.sort || (state.sort === 'implied' && th.getAttribute('data-sort') === 'implied'));
    });
  }

  function openDetail(slug) {
    var r = BY_SLUG[slug];
    if (!r) return;
    state.open = slug;
    var f = META.fit;
    var recomputed = impliedOf(r);
    var rank = ROWS.indexOf(r) + 1;
    var sec = document.getElementById('detail');
    var compRows = r.comps.map(function (c) {
      return '<tr><td>' + esc(NAMES[c.slug] || c.slug) + '</td><td class="num">' + c.ratio.toFixed(3) + '×</td></tr>';
    }).join('');
    sec.innerHTML =
      '<h2><span class="rank">#' + rank + '</span> ' + esc(r.name) +
      '<button class="close" id="detailClose" type="button">Close</button></h2>' +
      '<div class="dgrid"><div>' +
      '<h3>Implied value</h3>' +
      '<dl class="kv">' +
      '<dt>Implied value</dt><dd><b>' + money(r.implied) + '</b><span class="sub">recomputed live: ' + money(recomputed) + '</span></dd>' +
      '<dt>Range (±1 sd)</dt><dd>' + money(r.low) + ' – ' + money(r.high) + '</dd>' +
      '<dt>TVL</dt><dd>' + money(r.tvl) + '</dd>' +
      '<dt>Fitted multiple</dt><dd>' + r.mult.toFixed(3) + '×</dd>' +
      '<dt>7-day change</dt><dd>' + pct(r.g7) + '</dd>' +
      '<dt>Age, no token</dt><dd>' + ageFmt(r.age) + '</dd>' +
      '<dt>Category</dt><dd>' + esc(r.cat || '—') + '</dd>' +
      '<dt>Chains</dt><dd>' + esc((r.chains || []).join(', ')) + '</dd>' +
      '</dl>' +
      '<h3 style="margin-top:16px">How the number is built</h3>' +
      '<p class="breakdown">log<sub>10</sub>(value) = <b>' + f.intercept.toFixed(3) + '</b><br>' +
      '+ <b>' + f.slopeTvl.toFixed(3) + '</b> × log<sub>10</sub>(' + money(r.tvl).replace(/[^0-9.,$MBK]/g, '') + ') = ' + (f.slopeTvl * Math.log10(r.tvl)).toFixed(3) + '<br>' +
      '+ <b>' + f.coefGrowth.toFixed(3) + '</b> × growth ' + growthTerm(r).toFixed(2) + ' = ' + (f.coefGrowth * growthTerm(r)).toFixed(3) + '<br>' +
      '+ <b>' + f.coefAge.toFixed(3) + '</b> × age ' + Math.min(10, r.age).toFixed(1) + ' = ' + (f.coefAge * Math.min(10, r.age)).toFixed(3) + '</p>' +
      '<h3 style="margin-top:16px">Nearest launched comps</h3>' +
      '<table class="comps"><thead><tr><th>Protocol</th><th class="num">mcap / TVL</th></tr></thead><tbody>' + compRows + '</tbody></table>' +
      '<p class="risk">Comps are the launched protocols nearest in size and category. Their multiples are the market\u2019s, not the model\u2019s — the model\u2019s multiple for ' + esc(r.name) + ' is ' + r.mult.toFixed(3) + '×.</p>' +
      '</div><div>' +
      '<h3>Farm plan — five steps, mechanism-aware</h3>' +
      '<ol class="steps">' + planFor(r).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="risk">A plan is a starting point, not advice: check the protocol\u2019s own app before you deposit anything, never farm with money you cannot lose, and never pay anyone to claim a token. “No token” means the snapshot records none — a token may already exist that the snapshot does not carry.</p>' +
      '</div></div>';
    sec.hidden = false;
    document.getElementById('detailClose').addEventListener('click', closeDetail);
    renderBoard();
    sec.scrollIntoView({ behavior: 'auto', block: 'start' });
    if (history.replaceState) history.replaceState(null, '', '#detail=' + r.slug);
  }

  function closeDetail() {
    state.open = null;
    document.getElementById('detail').hidden = true;
    renderBoard();
    if (history.replaceState) history.replaceState(null, '', '#');
  }

  function renderCurve() {
    var sec = document.getElementById('curvePanel');
    var max = Math.max.apply(null, META.sizeCurve.map(function (b) { return b.medianMultiple; }));
    var bars = META.sizeCurve.map(function (b) {
      var h = Math.max(4, Math.round((b.medianMultiple / max) * 120));
      return '<div class="bar"><span>' + b.medianMultiple.toFixed(3) + '×</span><i style="height:' + h + 'px"></i><em>' + money(b.fromUsd) + '–' + money(b.toUsd) + '<br>' + b.count + ' tokens</em></div>';
    }).join('');
    var valRows = META.validation.map(function (v) {
      return '<tr><td>' + esc(v.label) + '</td><td class="num">' + v.train + ' / ' + v.test + '</td><td class="num">' + v.medianAbsLogErr.toFixed(3) + ' dex</td><td class="num">' + Math.round(v.withinTwoX * 100) + '%</td><td class="num">' + Math.round(v.withinThreeX * 100) + '%</td><td class="num">' + v.naiveMedianAbsLogErr.toFixed(3) + ' dex</td></tr>';
    }).join('');
    sec.innerHTML =
      '<h2>The size curve — big protocols carry small multiples</h2>' +
      '<p style="color:var(--ink-2);font-size:14px">Median market-cap / TVL of the launched comps, by TVL band. The curve is the model\u2019s slope in picture form: a $5M protocol carries roughly twenty times the multiple of a $5B one.</p>' +
      '<div class="bars">' + bars + '</div>' +
      '<h2 style="margin-top:18px">Validation — tested where it had not been fitted</h2>' +
      '<table><thead><tr><th>Slice</th><th class="num">Fit / test</th><th class="num">Median |log error|</th><th class="num">Within 2×</th><th class="num">Within 3×</th><th class="num">Naive baseline</th></tr></thead><tbody>' + valRows + '</tbody></table>' +
      '<p style="color:var(--ink-3);font-size:13px;margin-top:10px">Median error is in dex (log<sub>10</sub> units): 0.30 dex is about 2×, 0.60 dex about 4×. The naive baseline prices every test token at the training set\u2019s median mcap / TVL. The model beats it on every slice — but the bands are wide, and every implied value on this board carries one: see the ±1 sd range in each detail view.</p>';
  }

  function renderNote() {
    var v = META.validation;
    var body = document.getElementById('noteBody');
    body.innerHTML =
      '<p><b>What this board is.</b> A ranking of the ' + META.rows + ' pre-token protocols in the sealed snapshot — the ' + META.watchlist + ' on the house watchlist plus ' + META.early + ' early ones below the $50M floor — by what their token would be worth if it priced like the ' + META.launched + ' tokens that already launched. It does not predict whether or when any token launches, and it does not say a launch is coming.</p>' +
      '<p><b>How the price is fitted.</b> The model is one least-squares line on the launched comps: log<sub>10</sub>(market cap) on log<sub>10</sub>(TVL), the 7-day change and age. No protocol name is ever special-cased; a protocol\u2019s value comes only from its own figures. The growth term is a spike discount: the fitted coefficient is negative, so a one-week surge is discounted — the market in this snapshot pays for TVL that stays, not TVL that just arrived. Age adds almost nothing (coefficient ' + META.fit.coefAge.toFixed(3) + '), and the note says so rather than dressing it up.</p>' +
      '<p><b>How it was tested.</b> Four slices, each scored on tokens the fit had not seen: ' +
      v.map(function (s) { return s.label.split('—')[0].trim() + ' (' + s.medianAbsLogErr.toFixed(2) + ' dex median error, naive ' + s.naiveMedianAbsLogErr.toFixed(2) + ')'; }).join('; ') +
      '. The model beats the naive median multiple everywhere, and still misses by about 4× at the median — token pricing is noisy, and the board is honest about it.</p>' +
      '<p><b>What the board cannot see.</b></p><ul>' +
      '<li>The snapshot prices market cap, not fully diluted value — a token with most of its supply locked would price higher on an FDV basis.</li>' +
      '<li>The snapshot week was a down week (launched protocols\u2019 median 7-day change was about −9%): the growth term is fitted on that week, not on all weather.</li>' +
      '<li>The parent-protocol half of the watchlist rule cannot be checked from the snapshot\u2019s ten fields, so early rows below the floor are screened on the visible half only (category, version, wrapped/staked words, exchange names).</li>' +
      '<li>Points, quests and airdrop criteria change without warning; a farm plan written today can be stale tomorrow. Check the protocol\u2019s own app before you act.</li>' +
      '</ul>' +
      '<p><b>How to use it.</b> Start at the top, open a detail, read the comps before the plan: if the comps look nothing like the protocol, trust the comps, not the rank. Farm one or two protocols properly — a month of real use — rather than ten for an afternoon.</p>';
  }

  // ---- wiring -------------------------------------------------------------------

  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('watchOnly').addEventListener('change', function (e) { state.watchOnly = e.target.checked; renderBoard(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) { state.dir = -state.dir; }
      else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
      var sel = document.getElementById('sort');
      if (['implied', 'tvl', 'multiple', 'growth', 'age'].indexOf(key) >= 0) sel.value = key;
      renderBoard();
    });
  });

  renderMast();
  renderModel();
  renderControls();
  renderBoard();
  renderCurve();
  renderNote();

  var hash = (location.hash || '').replace(/^#detail=/, '');
  if (hash && BY_SLUG[hash]) openDetail(hash);
  window.addEventListener('hashchange', function () {
    var h = (location.hash || '').replace(/^#detail=/, '');
    if (h && BY_SLUG[h]) openDetail(h);
  });
})();

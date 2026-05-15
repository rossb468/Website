import json

with open('/sessions/festive-keen-bardeen/mnt/outputs/catalog_compact.json') as f:
    js_data = f.read()

html = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>1988 Porsche 944 — Parts Catalog</title>
<style>
:root {
  --bg: #0f0f0f;
  --surface: #1a1a1a;
  --surface2: #242424;
  --surface3: #2e2e2e;
  --border: #333;
  --text: #e8e8e8;
  --text2: #a0a0a0;
  --text3: #666;
  --red: #c0392b;
  --red-light: #e74c3c;
  --red-dark: #922b21;
  --gold: #d4a017;
  --blue: #2980b9;
  --blue-light: #3498db;
  --green: #27ae60;
  --sidebar-w: 280px;
  --topbar-h: 56px;
  --radius: 6px;
  --mono: 'Courier New', monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; font-size: 14px; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

/* TOP BAR */
#topbar {
  height: var(--topbar-h);
  background: #111;
  border-bottom: 2px solid var(--red);
  display: flex; align-items: center; gap: 16px; padding: 0 20px;
  flex-shrink: 0; z-index: 100;
}
#topbar .brand { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
#topbar .brand-crest { font-size: 24px; }
#topbar .brand-text { }
#topbar .brand-text h1 { font-size: 15px; font-weight: 700; color: var(--text); letter-spacing: 0.05em; }
#topbar .brand-text p { font-size: 11px; color: var(--text2); letter-spacing: 0.1em; text-transform: uppercase; }
#topbar .divider { width: 1px; height: 30px; background: var(--border); }
#search-wrap { flex: 1; max-width: 500px; position: relative; }
#global-search {
  width: 100%; padding: 8px 36px 8px 14px;
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 20px; color: var(--text); font-size: 14px; outline: none;
  transition: border-color 0.2s;
}
#global-search:focus { border-color: var(--red); }
#global-search::placeholder { color: var(--text3); }
.search-icon { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--text3); pointer-events: none; font-size: 16px; }
.nav-btns { display: flex; gap: 4px; margin-left: auto; }
.nav-btn {
  padding: 6px 14px; border: 1px solid var(--border); background: var(--surface2);
  border-radius: var(--radius); color: var(--text2); cursor: pointer; font-size: 13px;
  transition: all 0.15s; white-space: nowrap;
}
.nav-btn:hover { background: var(--surface3); color: var(--text); }
.nav-btn.active { background: var(--red); border-color: var(--red); color: #fff; }

/* LAYOUT */
#main-layout { display: flex; flex: 1; overflow: hidden; }

/* SIDEBAR */
#sidebar {
  width: var(--sidebar-w); background: var(--surface);
  border-right: 1px solid var(--border); overflow-y: auto; flex-shrink: 0;
}
#sidebar::-webkit-scrollbar { width: 6px; }
#sidebar::-webkit-scrollbar-track { background: transparent; }
#sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

.sidebar-header { padding: 14px 16px 10px; font-size: 11px; font-weight: 700; color: var(--text3); text-transform: uppercase; letter-spacing: 0.1em; }

.mg-group { border-bottom: 1px solid var(--border); }
.mg-header {
  display: flex; align-items: center; padding: 10px 16px; cursor: pointer;
  font-weight: 600; font-size: 13px; gap: 8px;
  transition: background 0.15s; user-select: none;
}
.mg-header:hover { background: var(--surface2); }
.mg-num { background: var(--red); color: #fff; border-radius: 3px; padding: 1px 6px; font-size: 11px; font-weight: 700; min-width: 22px; text-align: center; }
.mg-chevron { margin-left: auto; color: var(--text3); font-size: 12px; transition: transform 0.2s; }
.mg-group.open .mg-chevron { transform: rotate(90deg); }

.sg-list { display: none; background: rgba(0,0,0,0.2); }
.mg-group.open .sg-list { display: block; }

.sg-item { }
.sg-header {
  padding: 7px 16px 7px 32px; cursor: pointer; font-size: 12px; color: var(--text2);
  display: flex; align-items: center; gap: 6px; transition: background 0.15s; user-select: none;
}
.sg-header:hover { background: var(--surface2); color: var(--text); }
.sg-chevron { margin-left: auto; color: var(--text3); font-size: 11px; transition: transform 0.2s; }
.sg-item.open .sg-chevron { transform: rotate(90deg); }

.ill-list { display: none; }
.sg-item.open .ill-list { display: block; }
.ill-link {
  padding: 5px 16px 5px 44px; cursor: pointer; font-size: 12px; color: var(--text3);
  display: flex; align-items: center; gap: 6px; transition: all 0.15s;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ill-link:hover { background: var(--surface2); color: var(--text2); }
.ill-link.active { color: var(--red-light); background: rgba(192,57,43,0.1); }
.ill-id-badge { font-family: var(--mono); font-size: 10px; color: var(--text3); background: var(--surface3); padding: 1px 4px; border-radius: 3px; flex-shrink: 0; }

/* CONTENT */
#content { flex: 1; overflow-y: auto; }
#content::-webkit-scrollbar { width: 8px; }
#content::-webkit-scrollbar-track { background: transparent; }
#content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

/* VIEWS */
.view { display: none; padding: 24px; }
.view.active { display: block; }

/* HOME VIEW */
#home-view { }
.hero {
  background: linear-gradient(135deg, #1a0a0a 0%, #0f0f0f 100%);
  border: 1px solid var(--border); border-radius: 10px;
  padding: 32px; margin-bottom: 24px; position: relative; overflow: hidden;
}
.hero::before {
  content: ''; position: absolute; top: -50%; right: -10%;
  width: 400px; height: 400px;
  background: radial-gradient(circle, rgba(192,57,43,0.08) 0%, transparent 70%);
  pointer-events: none;
}
.hero h2 { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
.hero h2 span { color: var(--red-light); }
.hero p { color: var(--text2); font-size: 15px; margin-bottom: 20px; }
.stats-row { display: flex; gap: 24px; flex-wrap: wrap; }
.stat-card {
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px 20px; min-width: 120px;
}
.stat-card .num { font-size: 28px; font-weight: 800; color: var(--red-light); }
.stat-card .label { font-size: 12px; color: var(--text2); margin-top: 2px; }

.quick-section h3 { font-size: 14px; font-weight: 700; color: var(--text2); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
.mg-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.mg-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 14px 16px; cursor: pointer; transition: all 0.15s;
  display: flex; align-items: center; gap: 12px;
}
.mg-card:hover { border-color: var(--red); background: var(--surface2); transform: translateY(-1px); }
.mg-card-num { background: var(--red); color: #fff; border-radius: 4px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px; flex-shrink: 0; }
.mg-card-info .name { font-size: 13px; font-weight: 600; }
.mg-card-info .count { font-size: 11px; color: var(--text3); margin-top: 2px; }

/* ILLUSTRATION VIEW */
#ill-view .ill-header {
  display: flex; align-items: flex-start; gap: 20px; margin-bottom: 24px;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px;
}
.ill-header-info { flex: 1; }
.ill-header-info h2 { font-size: 20px; font-weight: 800; margin-bottom: 6px; }
.ill-header-info .ill-meta { display: flex; gap: 10px; flex-wrap: wrap; }
.meta-badge {
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 4px; padding: 3px 10px; font-size: 12px; color: var(--text2);
}
.meta-badge.mg-badge { background: var(--red-dark); border-color: var(--red); color: #fff; }
.meta-badge.sg-badge { background: var(--surface3); }
.meta-badge.id-badge { font-family: var(--mono); }

.ill-nav { display: flex; gap: 8px; }
.ill-nav-btn {
  padding: 6px 12px; border: 1px solid var(--border); background: var(--surface2);
  border-radius: var(--radius); cursor: pointer; font-size: 12px; color: var(--text2);
  transition: all 0.15s;
}
.ill-nav-btn:hover { border-color: var(--red); color: var(--red-light); }

/* Parts table */
.parts-table-wrap { overflow-x: auto; }
table.parts-table {
  width: 100%; border-collapse: collapse; font-size: 13px;
}
.parts-table th {
  background: var(--surface2); color: var(--text2); font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em; padding: 10px 12px;
  border-bottom: 2px solid var(--border); text-align: left; position: sticky; top: 0;
}
.parts-table td { padding: 9px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
.parts-table tr:hover td { background: var(--surface2); }
.parts-table tr:last-child td { border-bottom: none; }
.pos-cell { font-family: var(--mono); color: var(--text3); font-size: 12px; white-space: nowrap; }
.pnum-cell { font-family: var(--mono); color: var(--gold); font-size: 12px; white-space: nowrap; }
.pnum-cell a { color: var(--gold); text-decoration: none; }
.pnum-cell a:hover { color: #f0d060; text-decoration: underline; }
.desc-cell { color: var(--text); }
.desc-cell .remarks { font-size: 11px; color: var(--text3); margin-top: 2px; }
.qty-cell { color: var(--text2); text-align: center; white-space: nowrap; }
.model-cell { font-size: 11px; color: var(--blue-light); white-space: nowrap; }
.actions-cell { white-space: nowrap; }
.pelican-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; background: var(--surface3); border: 1px solid var(--border);
  border-radius: 4px; color: var(--text2); font-size: 11px; text-decoration: none;
  transition: all 0.15s; cursor: pointer;
}
.pelican-btn:hover { background: var(--red-dark); border-color: var(--red); color: #fff; }

/* SEARCH VIEW */
#search-view .search-header { margin-bottom: 16px; }
#search-view .search-header h2 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
#search-view .search-header p { color: var(--text2); font-size: 13px; }
.search-result-group { margin-bottom: 20px; }
.search-result-group .group-header {
  background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 8px 14px; margin-bottom: 8px; cursor: pointer;
  display: flex; align-items: center; gap: 10px;
}
.search-result-group .group-header:hover { background: var(--surface3); }
.group-ill-id { font-family: var(--mono); font-size: 12px; color: var(--gold); }
.group-title { font-weight: 600; font-size: 13px; }
.group-count { margin-left: auto; background: var(--red); color: #fff; border-radius: 10px; padding: 1px 8px; font-size: 11px; font-weight: 700; }

/* DATABASE VIEW */
#db-view { padding: 16px; }
#db-view .db-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
#db-view h2 { font-size: 18px; font-weight: 700; margin-right: 8px; }
.db-filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.db-filter-group { display: flex; align-items: center; gap: 6px; }
.db-filter-group label { font-size: 12px; color: var(--text2); white-space: nowrap; }
.db-select, .db-input {
  background: var(--surface2); border: 1px solid var(--border); color: var(--text);
  border-radius: var(--radius); padding: 5px 10px; font-size: 13px; outline: none;
}
.db-select:focus, .db-input:focus { border-color: var(--red); }
.db-input { min-width: 180px; }
.db-stats { margin-left: auto; font-size: 12px; color: var(--text2); white-space: nowrap; }

#db-table-wrap { overflow-x: auto; max-height: calc(100vh - 180px); overflow-y: auto; }
#db-table-wrap::-webkit-scrollbar { width: 8px; height: 8px; }
#db-table-wrap::-webkit-scrollbar-track { background: transparent; }
#db-table-wrap::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

table.db-table {
  width: 100%; border-collapse: collapse; font-size: 12px; min-width: 900px;
}
.db-table th {
  background: var(--surface2); color: var(--text2); font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.05em; padding: 9px 12px;
  border-bottom: 2px solid var(--border); text-align: left;
  position: sticky; top: 0; z-index: 10; cursor: pointer; user-select: none;
  white-space: nowrap;
}
.db-table th:hover { color: var(--text); background: var(--surface3); }
.db-table th .sort-icon { color: var(--text3); margin-left: 4px; }
.db-table th.sort-asc .sort-icon::after { content: " ▲"; }
.db-table th.sort-desc .sort-icon::after { content: " ▼"; }
.db-table td { padding: 7px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
.db-table tr:hover td { background: var(--surface2); }
.db-table tr:nth-child(even) td { background: rgba(255,255,255,0.01); }
.db-table tr:nth-child(even):hover td { background: var(--surface2); }
td.td-ill { font-family: var(--mono); color: var(--gold); font-size: 11px; white-space: nowrap; cursor: pointer; }
td.td-ill:hover { color: var(--red-light); text-decoration: underline; }
td.td-mg { font-size: 11px; }
td.td-pnum { font-family: var(--mono); color: var(--gold); white-space: nowrap; }
td.td-pnum a { color: var(--gold); text-decoration: none; }
td.td-pnum a:hover { text-decoration: underline; color: #f0d060; }
td.td-desc { max-width: 250px; }
td.td-model { font-size: 11px; color: var(--blue-light); }
td.td-qty { text-align: center; }
td.td-pos { font-family: var(--mono); color: var(--text3); font-size: 11px; }
.highlight { background: rgba(192, 57, 43, 0.3); border-radius: 2px; padding: 0 2px; }

/* MISC */
.empty-state { text-align: center; padding: 60px 20px; color: var(--text3); }
.empty-state .icon { font-size: 48px; margin-bottom: 12px; }
.empty-state p { font-size: 15px; }

.section-divider { height: 1px; background: var(--border); margin: 20px 0; }

/* Scrollbar global */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #444; }
</style>
</head>
<body>

<!-- TOP BAR -->
<div id="topbar">
  <div class="brand">
    <span class="brand-crest">🏎️</span>
    <div class="brand-text">
      <h1>Porsche 944 — Parts Catalog</h1>
      <p>Model 9442 &middot; 1988 &middot; EPC</p>
    </div>
  </div>
  <div class="divider"></div>
  <div id="search-wrap">
    <input type="text" id="global-search" placeholder="Search part number or description…" autocomplete="off">
    <span class="search-icon">🔍</span>
  </div>
  <div class="nav-btns">
    <button class="nav-btn active" onclick="showView('home')">Home</button>
    <button class="nav-btn" onclick="showView('search')">Search</button>
    <button class="nav-btn" onclick="showView('db')">Database</button>
  </div>
</div>

<!-- MAIN LAYOUT -->
<div id="main-layout">

  <!-- SIDEBAR -->
  <div id="sidebar">
    <div class="sidebar-header">Browse by Group</div>
    <div id="sidebar-tree"></div>
  </div>

  <!-- CONTENT -->
  <div id="content">

    <!-- HOME VIEW -->
    <div id="home-view" class="view active">
      <div class="hero">
        <h2>1988 Porsche <span>944</span> Parts Catalog</h2>
        <p>Complete electronic parts catalog (EPC) for the Porsche 9442 model year 1988. Browse by main group, search by part number or keyword, or explore the full database.</p>
        <div class="stats-row" id="home-stats"></div>
      </div>
      <div class="quick-section">
        <h3>Main Groups</h3>
        <div class="mg-cards" id="home-mg-cards"></div>
      </div>
    </div>

    <!-- ILLUSTRATION VIEW -->
    <div id="ill-view" class="view">
      <div id="ill-content"></div>
    </div>

    <!-- SEARCH VIEW -->
    <div id="search-view" class="view">
      <div class="search-header">
        <h2>Search Results</h2>
        <p id="search-result-info" style="color:var(--text2);font-size:13px;"></p>
      </div>
      <div id="search-results"></div>
    </div>

    <!-- DATABASE VIEW -->
    <div id="db-view" class="view">
      <div class="db-header">
        <h2>Parts Database</h2>
        <div class="db-filters">
          <div class="db-filter-group">
            <label>Group:</label>
            <select id="db-mg-filter" class="db-select" onchange="dbApplyFilters()">
              <option value="">All Groups</option>
            </select>
          </div>
          <div class="db-filter-group">
            <label>Filter:</label>
            <input type="text" id="db-text-filter" class="db-input" placeholder="Part # or description…" oninput="dbApplyFilters()">
          </div>
          <div class="db-filter-group">
            <label>Model:</label>
            <select id="db-model-filter" class="db-select" onchange="dbApplyFilters()">
              <option value="">All Models</option>
            </select>
          </div>
          <span class="db-stats" id="db-stats">— parts</span>
        </div>
      </div>
      <div id="db-table-wrap">
        <table class="db-table" id="db-table">
          <thead>
            <tr>
              <th onclick="dbSort(\'ill\')" data-col="ill">Illustration<span class="sort-icon"></span></th>
              <th onclick="dbSort(\'mg\')" data-col="mg">Group<span class="sort-icon"></span></th>
              <th onclick="dbSort(\'pos\')" data-col="pos">Pos<span class="sort-icon"></span></th>
              <th onclick="dbSort(\'pnum\')" data-col="pnum">Part Number<span class="sort-icon"></span></th>
              <th onclick="dbSort(\'desc\')" data-col="desc">Description<span class="sort-icon"></span></th>
              <th onclick="dbSort(\'qty\')" data-col="qty">Qty<span class="sort-icon"></span></th>
              <th onclick="dbSort(\'model\')" data-col="model">Model<span class="sort-icon"></span></th>
              <th>Links</th>
            </tr>
          </thead>
          <tbody id="db-tbody"></tbody>
        </table>
      </div>
    </div>

  </div><!-- /content -->
</div><!-- /main-layout -->

<script>
// ============================================================
// DATA
// ============================================================
const CATALOG = ''' + js_data + ''';

// Flatten all parts for DB view
const ALL_PARTS = [];
const ILL_ORDER = Object.keys(CATALOG.illustrations).sort();
for (const illId of ILL_ORDER) {
  const ill = CATALOG.illustrations[illId];
  for (const p of ill.parts) {
    ALL_PARTS.push({
      ill: illId,
      mg: ill.mg,
      mg_name: CATALOG.mg_names[String(ill.mg)] || `Group ${ill.mg}`,
      sg: ill.sg,
      ill_title: ill.title,
      pos: p[0],
      pnum: p[1],
      desc: p[2],
      qty: p[3],
      model: p[4],
      remarks: p[5]
    });
  }
}

// ============================================================
// UTILITIES
// ============================================================
function pnumToLink(pnum) {
  // PelicanParts search URL
  const q = pnum.replace(/\\s+/g, '-');
  return `https://www.pelicanparts.com/catalog/porsche/search.htm?q=${encodeURIComponent(pnum)}`;
}

function pnumToEbay(pnum) {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(pnum.replace(/\\s+/g,'+'))}+porsche`;
}

function pnumFormatted(pnum) {
  return pnum; // already has spaces
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function highlightText(text, query) {
  if (!query) return escHtml(text);
  const re = new RegExp(query.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&'), 'gi');
  return escHtml(text).replace(re, m => `<span class="highlight">${m}</span>`);
}

// ============================================================
// VIEWS
// ============================================================
let currentView = 'home';
let currentIll = null;

function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(view + '-view').classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const btns = document.querySelectorAll('.nav-btn');
  btns.forEach(b => {
    if (b.textContent.trim().toLowerCase() === view || 
        (view==='home' && b.textContent.trim()==='Home') ||
        (view==='search' && b.textContent.trim()==='Search') ||
        (view==='db' && b.textContent.trim()==='Database')) {
      b.classList.add('active');
    }
  });
  currentView = view;
  if (view === 'db') dbInit();
}

// ============================================================
// HOME VIEW
// ============================================================
function initHome() {
  const statsEl = document.getElementById('home-stats');
  const totalParts = ALL_PARTS.length;
  const totalIlls = ILL_ORDER.length;
  const uniquePnums = new Set(ALL_PARTS.map(p=>p.pnum)).size;
  const totalMGs = Object.keys(CATALOG.mg_names).length;

  statsEl.innerHTML = [
    [totalParts.toLocaleString(), 'Total Parts'],
    [uniquePnums.toLocaleString(), 'Unique Part Numbers'],
    [totalIlls, 'Illustrations'],
    [totalMGs, 'Main Groups']
  ].map(([n,l]) => `<div class="stat-card"><div class="num">${n}</div><div class="label">${l}</div></div>`).join('');

  // MG cards
  const cardsEl = document.getElementById('home-mg-cards');
  const mgCounts = {};
  ALL_PARTS.forEach(p => { mgCounts[p.mg] = (mgCounts[p.mg]||0)+1; });

  cardsEl.innerHTML = Object.entries(CATALOG.mg_names).map(([mg, name]) => {
    const cnt = mgCounts[parseInt(mg)] || 0;
    return `<div class="mg-card" onclick="expandMG(${mg})">
      <div class="mg-card-num">${mg}</div>
      <div class="mg-card-info">
        <div class="name">${name}</div>
        <div class="count">${cnt} parts</div>
      </div>
    </div>`;
  }).join('');
}

function expandMG(mg) {
  // Open the MG group in sidebar and scroll to first illustration
  const groupEl = document.querySelector(`.mg-group[data-mg="${mg}"]`);
  if (groupEl) {
    if (!groupEl.classList.contains('open')) groupEl.classList.add('open');
    groupEl.scrollIntoView({behavior:'smooth', block:'start'});
  }
  // Navigate to first illustration in this MG
  const firstIll = ILL_ORDER.find(id => CATALOG.illustrations[id].mg === parseInt(mg));
  if (firstIll) navigateToIll(firstIll);
}

// ============================================================
// SIDEBAR TREE
// ============================================================
function buildSidebar() {
  // Group: mg -> sg -> [ills]
  const tree = {};
  for (const illId of ILL_ORDER) {
    const ill = CATALOG.illustrations[illId];
    const mg = ill.mg;
    const sg = ill.sg;
    if (!tree[mg]) tree[mg] = {};
    if (!tree[mg][sg]) tree[mg][sg] = [];
    tree[mg][sg].push(illId);
  }

  const container = document.getElementById('sidebar-tree');
  let html = '';
  for (const mg of Object.keys(tree).map(Number).sort()) {
    const mgName = CATALOG.mg_names[String(mg)] || `Group ${mg}`;
    const sgs = tree[mg];
    html += `<div class="mg-group" data-mg="${mg}">
      <div class="mg-header" onclick="toggleMG(this)">
        <span class="mg-num">${mg}</span>
        <span>${mgName}</span>
        <span class="mg-chevron">▶</span>
      </div>
      <div class="sg-list">`;
    for (const sg of Object.keys(sgs).map(Number).sort()) {
      const ills = sgs[sg];
      // SG name from first ill
      const firstIll = CATALOG.illustrations[ills[0]];
      const sgName = firstIll.title || `Sub-group ${sg}`;
      html += `<div class="sg-item" data-sg="${sg}">
        <div class="sg-header" onclick="toggleSG(this)">
          <span style="color:var(--text3);font-size:11px;font-family:var(--mono)">${String(sg).padStart(2,'0')}</span>
          <span>${sgName}</span>
          <span class="sg-chevron">▶</span>
        </div>
        <div class="ill-list">`;
      for (const illId of ills) {
        const ill = CATALOG.illustrations[illId];
        html += `<div class="ill-link" id="sidebar-ill-${illId}" onclick="navigateToIll('${illId}')">
          <span class="ill-id-badge">${illId}</span>
          <span style="overflow:hidden;text-overflow:ellipsis">${ill.title}</span>
        </div>`;
      }
      html += `</div></div>`;
    }
    html += `</div></div>`;
  }
  container.innerHTML = html;
}

function toggleMG(el) {
  el.closest('.mg-group').classList.toggle('open');
}
function toggleSG(el) {
  el.closest('.sg-item').classList.toggle('open');
}

// ============================================================
// ILLUSTRATION VIEW
// ============================================================
function navigateToIll(illId) {
  currentIll = illId;
  const ill = CATALOG.illustrations[illId];
  if (!ill) return;
  showView('ill');

  // Update sidebar active
  document.querySelectorAll('.ill-link').forEach(l => l.classList.remove('active'));
  const link = document.getElementById(`sidebar-ill-${illId}`);
  if (link) {
    link.classList.add('active');
    // Open parent sg and mg
    const sgItem = link.closest('.sg-item');
    const mgGroup = link.closest('.mg-group');
    if (sgItem) sgItem.classList.add('open');
    if (mgGroup) mgGroup.classList.add('open');
    link.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  // Find prev/next illustrations
  const idx = ILL_ORDER.indexOf(illId);
  const prevIll = idx > 0 ? ILL_ORDER[idx-1] : null;
  const nextIll = idx < ILL_ORDER.length-1 ? ILL_ORDER[idx+1] : null;

  const mgName = CATALOG.mg_names[String(ill.mg)] || `Group ${ill.mg}`;

  let html = `<div class="ill-header">
    <div class="ill-header-info">
      <h2>Illustration ${illId} — ${escHtml(ill.title)}</h2>
      <div class="ill-meta" style="margin-top:8px">
        <span class="meta-badge mg-badge">MG ${ill.mg}: ${escHtml(mgName)}</span>
        <span class="meta-badge sg-badge">SG ${String(ill.sg).padStart(2,'0')}</span>
        <span class="meta-badge id-badge">${illId}</span>
        <span class="meta-badge">${ill.parts.length} parts</span>
      </div>
    </div>
    <div class="ill-nav">
      ${prevIll ? `<button class="ill-nav-btn" onclick="navigateToIll('${prevIll}')">← ${prevIll}</button>` : ''}
      ${nextIll ? `<button class="ill-nav-btn" onclick="navigateToIll('${nextIll}')">${nextIll} →</button>` : ''}
    </div>
  </div>`;

  if (ill.parts.length === 0) {
    html += `<div class="empty-state"><div class="icon">📦</div><p>No parts data for this illustration.</p></div>`;
  } else {
    html += `<div class="parts-table-wrap"><table class="parts-table">
      <thead><tr>
        <th style="width:50px">Pos</th>
        <th style="width:160px">Part Number</th>
        <th>Description</th>
        <th style="width:50px;text-align:center">Qty</th>
        <th style="width:90px">Model</th>
        <th style="width:100px">Links</th>
      </tr></thead><tbody>`;
    for (const p of ill.parts) {
      const [pos,pnum,desc,qty,model,remarks] = p;
      const pp_url = pnumToLink(pnum);
      const eb_url = pnumToEbay(pnum);
      html += `<tr>
        <td class="pos-cell">${escHtml(pos)}</td>
        <td class="pnum-cell"><a href="${pp_url}" target="_blank" title="Search on PelicanParts">${escHtml(pnum)}</a></td>
        <td class="desc-cell">
          ${escHtml(desc)}
          ${remarks ? `<div class="remarks">${escHtml(remarks)}</div>` : ''}
        </td>
        <td class="qty-cell">${escHtml(qty)}</td>
        <td class="model-cell">${escHtml(model)}</td>
        <td class="actions-cell">
          <a class="pelican-btn" href="${pp_url}" target="_blank" title="Search on PelicanParts.com">🔧 Pelican</a>
          <a class="pelican-btn" href="${eb_url}" target="_blank" title="Search on eBay" style="margin-top:3px">🛒 eBay</a>
        </td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  document.getElementById('ill-content').innerHTML = html;
  document.getElementById('content').scrollTo(0,0);
}

// ============================================================
// SEARCH
// ============================================================
let searchTimeout = null;

function doSearch(query) {
  query = query.trim();
  if (!query) return;

  showView('search');
  const q = query.toLowerCase();

  // Group results by illustration
  const grouped = {};
  for (const p of ALL_PARTS) {
    const matchPnum = p.pnum.toLowerCase().includes(q);
    const matchDesc = p.desc.toLowerCase().includes(q);
    const matchRemarks = p.remarks.toLowerCase().includes(q);
    const matchModel = p.model.toLowerCase().includes(q);
    if (matchPnum || matchDesc || matchRemarks || matchModel) {
      if (!grouped[p.ill]) grouped[p.ill] = [];
      grouped[p.ill].push(p);
    }
  }

  const ills = Object.keys(grouped);
  const totalParts = ills.reduce((s,k) => s+grouped[k].length, 0);

  document.getElementById('search-result-info').textContent =
    `Found ${totalParts} parts in ${ills.length} illustrations for "${query}"`;

  if (ills.length === 0) {
    document.getElementById('search-results').innerHTML =
      `<div class="empty-state"><div class="icon">🔍</div><p>No results found for "<strong>${escHtml(query)}</strong>"</p></div>`;
    return;
  }

  let html = '';
  for (const illId of ills.sort()) {
    const ill = CATALOG.illustrations[illId];
    const parts = grouped[illId];
    html += `<div class="search-result-group">
      <div class="group-header" onclick="navigateToIll('${illId}')">
        <span class="group-ill-id">${illId}</span>
        <span class="group-title">${escHtml(ill.title)}</span>
        <span style="font-size:12px;color:var(--text3)">${CATALOG.mg_names[String(ill.mg)]||''}</span>
        <span class="group-count">${parts.length}</span>
      </div>
      <div class="parts-table-wrap"><table class="parts-table">
        <thead><tr>
          <th style="width:50px">Pos</th>
          <th style="width:160px">Part Number</th>
          <th>Description</th>
          <th style="width:50px;text-align:center">Qty</th>
          <th style="width:90px">Model</th>
          <th style="width:100px">Links</th>
        </tr></thead><tbody>`;
    for (const p of parts) {
      const pp_url = pnumToLink(p.pnum);
      const eb_url = pnumToEbay(p.pnum);
      html += `<tr>
        <td class="pos-cell">${escHtml(p.pos)}</td>
        <td class="pnum-cell"><a href="${pp_url}" target="_blank">${highlightText(p.pnum, query)}</a></td>
        <td class="desc-cell">
          ${highlightText(p.desc, query)}
          ${p.remarks ? `<div class="remarks">${highlightText(p.remarks, query)}</div>` : ''}
        </td>
        <td class="qty-cell">${escHtml(p.qty)}</td>
        <td class="model-cell">${escHtml(p.model)}</td>
        <td class="actions-cell">
          <a class="pelican-btn" href="${pp_url}" target="_blank">🔧 Pelican</a>
        </td>
      </tr>`;
    }
    html += `</tbody></table></div></div>`;
  }

  document.getElementById('search-results').innerHTML = html;
  document.getElementById('content').scrollTo(0,0);
}

// ============================================================
// DATABASE VIEW
// ============================================================
let dbInitialized = false;
let dbFilteredParts = [];
let dbSortCol = 'ill';
let dbSortDir = 1;

function dbInit() {
  if (dbInitialized) return;
  dbInitialized = true;

  // Populate MG filter
  const mgSel = document.getElementById('db-mg-filter');
  Object.entries(CATALOG.mg_names).forEach(([mg, name]) => {
    const opt = document.createElement('option');
    opt.value = mg;
    opt.textContent = `MG ${mg}: ${name}`;
    mgSel.appendChild(opt);
  });

  // Populate model filter
  const models = [...new Set(ALL_PARTS.map(p=>p.model).filter(Boolean))].sort();
  const modelSel = document.getElementById('db-model-filter');
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    modelSel.appendChild(opt);
  });

  dbApplyFilters();
}

function dbApplyFilters() {
  const mgFilter = document.getElementById('db-mg-filter').value;
  const textFilter = document.getElementById('db-text-filter').value.toLowerCase().trim();
  const modelFilter = document.getElementById('db-model-filter').value;

  dbFilteredParts = ALL_PARTS.filter(p => {
    if (mgFilter && String(p.mg) !== mgFilter) return false;
    if (modelFilter && p.model !== modelFilter) return false;
    if (textFilter) {
      if (!p.pnum.toLowerCase().includes(textFilter) &&
          !p.desc.toLowerCase().includes(textFilter) &&
          !p.ill.toLowerCase().includes(textFilter) &&
          !p.remarks.toLowerCase().includes(textFilter)) return false;
    }
    return true;
  });

  dbSortAndRender();
}

function dbSort(col) {
  if (dbSortCol === col) {
    dbSortDir = -dbSortDir;
  } else {
    dbSortCol = col;
    dbSortDir = 1;
  }
  // Update header classes
  document.querySelectorAll('.db-table th').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    if (th.dataset.col === col) {
      th.classList.add(dbSortDir === 1 ? 'sort-asc' : 'sort-desc');
    }
  });
  dbSortAndRender();
}

function dbSortAndRender() {
  const col = dbSortCol;
  const dir = dbSortDir;
  const sorted = [...dbFilteredParts].sort((a,b) => {
    let av = a[col]||'', bv = b[col]||'';
    if (col === 'mg' || col === 'sg') { av = Number(av); bv = Number(bv); }
    if (col === 'qty') { av = av === 'X' ? 999 : Number(av)||0; bv = bv === 'X' ? 999 : Number(bv)||0; }
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return 0;
  });

  const textFilter = document.getElementById('db-text-filter').value.trim();
  const tbody = document.getElementById('db-tbody');
  const CHUNK = 2000; // render all but limit for perf

  document.getElementById('db-stats').textContent = `${sorted.length.toLocaleString()} of ${ALL_PARTS.length.toLocaleString()} parts`;

  let html = '';
  const limit = Math.min(sorted.length, 5000);
  for (let i = 0; i < limit; i++) {
    const p = sorted[i];
    const pp_url = pnumToLink(p.pnum);
    const eb_url = pnumToEbay(p.pnum);
    html += `<tr>
      <td class="td-ill" onclick="navigateToIll('${p.ill}')">${p.ill}</td>
      <td class="td-mg" title="${escHtml(p.mg_name)}"><span class="mg-num" style="background:var(--red);color:#fff;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:700">${p.mg}</span></td>
      <td class="td-pos">${escHtml(p.pos)}</td>
      <td class="td-pnum"><a href="${pp_url}" target="_blank">${highlightText(p.pnum, textFilter)}</a></td>
      <td class="td-desc">
        ${highlightText(p.desc, textFilter)}
        ${p.remarks ? `<div style="font-size:10px;color:var(--text3)">${escHtml(p.remarks)}</div>` : ''}
      </td>
      <td class="td-qty">${escHtml(p.qty)}</td>
      <td class="td-model">${escHtml(p.model)}</td>
      <td><a class="pelican-btn" href="${pp_url}" target="_blank">🔧</a> <a class="pelican-btn" href="${eb_url}" target="_blank">🛒</a></td>
    </tr>`;
  }
  if (sorted.length > 5000) {
    html += `<tr><td colspan="8" style="text-align:center;padding:12px;color:var(--text3);font-size:12px">Showing first 5,000 of ${sorted.length.toLocaleString()} results. Use filters to narrow down.</td></tr>`;
  }
  tbody.innerHTML = html;
}

// ============================================================
// SEARCH EVENT
// ============================================================
const searchInput = document.getElementById('global-search');
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const q = searchInput.value.trim();
    if (q) doSearch(q);
  }
});
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  if (q.length >= 3) {
    searchTimeout = setTimeout(() => doSearch(q), 350);
  }
});

// ============================================================
// INIT
// ============================================================
buildSidebar();
initHome();
</script>
</body>
</html>'''

with open('/sessions/festive-keen-bardeen/mnt/outputs/porsche944_catalog.html', 'w', encoding='utf-8') as f:
    f.write(html)

import os
size = os.path.getsize('/sessions/festive-keen-bardeen/mnt/outputs/porsche944_catalog.html')
print(f"Written: porsche944_catalog.html ({size:,} bytes / {size/1024/1024:.1f} MB)")

import json, os

BASE = '/sessions/festive-keen-bardeen/mnt/outputs'
with open(f'{BASE}/master_compact.json') as f:
    js_data = f.read()

HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Porsche 944 — Master Parts Database</title>
<style>
:root{
  --bg:#0f0f0f;--s1:#1a1a1a;--s2:#242424;--s3:#2e2e2e;
  --bd:#333;--t1:#e8e8e8;--t2:#a0a0a0;--t3:#666;
  --red:#c0392b;--rdl:#e74c3c;--rdk:#922b21;
  --gold:#d4a017;--bl:#2980b9;--bll:#3498db;
  --radius:6px;--mono:'Courier New',monospace;
  --sw:272px;--th:56px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--t1);font-family:system-ui,-apple-system,sans-serif;font-size:14px;display:flex;flex-direction:column;height:100vh;overflow:hidden}

/* ── TOPBAR ── */
#topbar{height:var(--th);background:#111;border-bottom:2px solid var(--red);display:flex;align-items:center;gap:12px;padding:0 16px;flex-shrink:0;z-index:100}
.brand{display:flex;align-items:center;gap:8px;white-space:nowrap}
.brand h1{font-size:14px;font-weight:700;letter-spacing:.04em}
.brand p{font-size:10px;color:var(--t2);letter-spacing:.1em;text-transform:uppercase}
.vdiv{width:1px;height:28px;background:var(--bd);flex-shrink:0}
#search-wrap{flex:1;max-width:440px;position:relative}
#gsearch{width:100%;padding:7px 34px 7px 12px;background:var(--s2);border:1px solid var(--bd);border-radius:18px;color:var(--t1);font-size:13px;outline:none;transition:border-color .2s}
#gsearch:focus{border-color:var(--red)}
#gsearch::placeholder{color:var(--t3)}
.si{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--t3);pointer-events:none}
.nav-area{display:flex;gap:4px;margin-left:auto;align-items:center}
.nb{padding:5px 12px;border:1px solid var(--bd);background:var(--s2);border-radius:var(--radius);color:var(--t2);cursor:pointer;font-size:12px;transition:all .15s;white-space:nowrap}
.nb:hover{background:var(--s3);color:var(--t1)}
.nb.active{background:var(--red);border-color:var(--red);color:#fff}
.vdiv2{width:1px;height:20px;background:var(--bd)}
/* year filter pills */
#year-filters{display:flex;gap:3px}
.yf{padding:4px 10px;border:1px solid var(--bd);border-radius:12px;cursor:pointer;font-size:11px;font-weight:600;color:var(--t3);background:transparent;transition:all .15s;white-space:nowrap}
.yf:hover{opacity:.8}
.yf.on{color:#fff}

/* ── LAYOUT ── */
#layout{display:flex;flex:1;overflow:hidden}

/* ── SIDEBAR ── */
#sidebar{width:var(--sw);background:var(--s1);border-right:1px solid var(--bd);overflow-y:auto;flex-shrink:0}
#sidebar::-webkit-scrollbar{width:5px}
#sidebar::-webkit-scrollbar-thumb{background:var(--bd);border-radius:3px}
.sb-hdr{padding:12px 14px 8px;font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.1em}
.mg-grp{border-bottom:1px solid var(--bd)}
.mg-hdr{display:flex;align-items:center;padding:9px 14px;cursor:pointer;font-weight:600;font-size:12px;gap:7px;transition:background .15s;user-select:none}
.mg-hdr:hover{background:var(--s2)}
.mg-num{background:var(--red);color:#fff;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:700;min-width:20px;text-align:center}
.mg-chv{margin-left:auto;color:var(--t3);font-size:11px;transition:transform .2s}
.mg-grp.open .mg-chv{transform:rotate(90deg)}
.sg-list{display:none;background:rgba(0,0,0,.2)}
.mg-grp.open .sg-list{display:block}
.sg-itm{}
.sg-hdr{padding:6px 14px 6px 28px;cursor:pointer;font-size:11px;color:var(--t2);display:flex;align-items:center;gap:5px;transition:background .15s;user-select:none}
.sg-hdr:hover{background:var(--s2);color:var(--t1)}
.sg-chv{margin-left:auto;color:var(--t3);font-size:10px;transition:transform .2s}
.sg-itm.open .sg-chv{transform:rotate(90deg)}
.ill-list{display:none}
.sg-itm.open .ill-list{display:block}
.ill-lnk{padding:4px 14px 4px 40px;cursor:pointer;font-size:11px;color:var(--t3);display:flex;align-items:center;gap:5px;transition:all .15s;overflow:hidden}
.ill-lnk:hover{background:var(--s2);color:var(--t2)}
.ill-lnk.active{color:var(--rdl);background:rgba(192,57,43,.1)}
.ill-badge{font-family:var(--mono);font-size:9px;color:var(--t3);background:var(--s3);padding:1px 3px;border-radius:2px;flex-shrink:0}

/* ── CONTENT ── */
#content{flex:1;overflow-y:auto}
#content::-webkit-scrollbar{width:7px}
#content::-webkit-scrollbar-thumb{background:var(--bd);border-radius:4px}
.view{display:none;padding:20px}
.view.active{display:block}
#db-view{padding:14px}

/* ── HOME ── */
.hero{background:linear-gradient(135deg,#1a0a0a,#0f0f0f);border:1px solid var(--bd);border-radius:10px;padding:28px;margin-bottom:20px;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-40%;right:-5%;width:350px;height:350px;background:radial-gradient(circle,rgba(192,57,43,.07),transparent 70%);pointer-events:none}
.hero h2{font-size:26px;font-weight:800;margin-bottom:6px}.hero h2 span{color:var(--rdl)}
.hero p{color:var(--t2);font-size:14px;margin-bottom:18px}
.stats-row{display:flex;gap:16px;flex-wrap:wrap}
.stat{background:var(--s2);border:1px solid var(--bd);border-radius:var(--radius);padding:14px 18px}
.stat .n{font-size:26px;font-weight:800;color:var(--rdl)}
.stat .l{font-size:11px;color:var(--t2);margin-top:2px}
.home-sec h3{font-size:12px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
.mg-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
.mg-card{background:var(--s1);border:1px solid var(--bd);border-radius:var(--radius);padding:12px 14px;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:10px}
.mg-card:hover{border-color:var(--red);background:var(--s2);transform:translateY(-1px)}
.mg-card-n{background:var(--red);color:#fff;border-radius:4px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0}
.mg-card-t .name{font-size:12px;font-weight:600}
.mg-card-t .cnt{font-size:10px;color:var(--t3);margin-top:1px}

/* ── ILL VIEW ── */
.ill-hdr{display:flex;align-items:flex-start;gap:16px;margin-bottom:16px;background:var(--s1);border:1px solid var(--bd);border-radius:var(--radius);padding:16px}
.ill-hdr-info{flex:1}
.ill-hdr-info h2{font-size:18px;font-weight:800;margin-bottom:6px}
.ill-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.tag{background:var(--s2);border:1px solid var(--bd);border-radius:4px;padding:2px 8px;font-size:11px;color:var(--t2)}
.tag.mg-tag{background:var(--rdk);border-color:var(--red);color:#fff}
.ill-avail{font-size:11px;color:var(--t3);display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.ill-nav-btns{display:flex;gap:6px;align-items:center}
.inb{padding:5px 10px;border:1px solid var(--bd);background:var(--s2);border-radius:var(--radius);cursor:pointer;font-size:11px;color:var(--t2);transition:all .15s}
.inb:hover{border-color:var(--red);color:var(--rdl)}
/* action buttons */
.act-btn{display:inline-flex;align-items:center;gap:3px;padding:4px 9px;border:1px solid var(--bd);border-radius:var(--radius);font-size:11px;color:var(--t2);background:var(--s2);text-decoration:none;cursor:pointer;transition:all .15s;white-space:nowrap}
.act-btn:hover{background:var(--rdk);border-color:var(--red);color:#fff}
.act-btn.pdf{border-color:#555;color:#d4a017}
.act-btn.pdf:hover{background:#3a2800;border-color:#d4a017;color:#f0c040}
.act-btn.pp:hover{background:#0d2a40;border-color:#3498db;color:#fff}
.act-btn.eb:hover{background:#2a0a50;border-color:#9b59b6;color:#fff}
.ill-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}

/* ── PARTS TABLE ── */
.pt-wrap{overflow-x:auto}
table.pt{width:100%;border-collapse:collapse;font-size:12px}
table.pt th{background:var(--s2);color:var(--t2);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:8px 10px;border-bottom:2px solid var(--bd);text-align:left;position:sticky;top:0;white-space:nowrap}
table.pt td{padding:7px 10px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:middle}
table.pt tr:hover td{background:var(--s2)}
/* grouped parts */
tr.pos-first td{border-top:1px solid rgba(255,255,255,.1)}
tr.desc-hdr td{background:rgba(255,255,255,.012);border-top:none;border-bottom:none;padding:3px 10px 2px}
tr.desc-hdr .grp-desc{font-size:11px;font-weight:600;color:var(--t2);font-style:italic;padding-left:14px}
tr.variant td{border-bottom:none;padding:4px 10px 4px 20px}
tr.variant.lvl2 td{padding-left:36px}
tr.variant:last-of-type td, tr.variant+tr:not(.variant) td{border-bottom:1px solid rgba(255,255,255,.04)}
tr.variant.sup td{opacity:.5}
tr.sup-pred td{padding:2px 10px 2px 0;border-bottom:none;opacity:.5}
.sup-label{font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;margin-right:5px;font-style:normal}
tr.single td{padding:7px 10px}
tr.pos-single td{padding:5px 10px;border-bottom:none}
tr.pos-single:last-of-type td, tr.pos-single+tr:not(.pos-single) td{border-bottom:1px solid rgba(255,255,255,.04)}
.pnum{font-family:var(--mono);color:var(--gold);white-space:nowrap;cursor:pointer}
.pnum:hover{color:#f0d060;text-decoration:underline}
.pnum.sup-pnum{text-decoration:line-through;color:var(--t3);cursor:default}
.pnum.sup-pnum:hover{text-decoration:line-through;color:var(--t3)}
.sup-arrow{font-size:10px;color:var(--t3);margin:0 3px}
.pos-cell{font-family:var(--mono);color:var(--t3);font-size:10px;white-space:nowrap}
.qty-cell{color:var(--t2);text-align:center;white-space:nowrap}
.model-cell{font-size:10px;color:var(--bll);white-space:nowrap}
.remark-cell{font-size:10px;color:var(--t3);max-width:160px}
.links-cell{white-space:nowrap}

/* ── YEAR BADGES ── */
.yb{display:inline-block;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:700;color:#fff;margin:1px;white-space:nowrap}
.yb-dim{opacity:.2}

/* ── SEARCH VIEW ── */
.srch-hdr{margin-bottom:14px}
.srch-hdr h2{font-size:18px;font-weight:700;margin-bottom:3px}
.srch-info{color:var(--t2);font-size:12px}
.srch-group{margin-bottom:16px;border:1px solid var(--bd);border-radius:var(--radius);overflow:hidden}
.srch-group-hdr{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--s2);cursor:pointer;flex-wrap:wrap}
.srch-group-hdr:hover{background:var(--s3)}
.srch-ill-id{font-family:var(--mono);font-size:11px;color:var(--gold)}
.srch-ill-title{font-weight:600;font-size:12px}
.srch-cnt{margin-left:auto;background:var(--red);color:#fff;border-radius:9px;padding:1px 7px;font-size:10px;font-weight:700}
.hl{background:rgba(192,57,43,.35);border-radius:2px;padding:0 1px}

/* ── DB VIEW ── */
.db-hdr{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.db-hdr h2{font-size:16px;font-weight:700}
.flt-grp{display:flex;align-items:center;gap:5px}
.flt-grp label{font-size:11px;color:var(--t2);white-space:nowrap}
.fsel,.finput{background:var(--s2);border:1px solid var(--bd);color:var(--t1);border-radius:var(--radius);padding:4px 8px;font-size:12px;outline:none}
.fsel:focus,.finput:focus{border-color:var(--red)}
.finput{min-width:170px}
.db-cnt{margin-left:auto;font-size:11px;color:var(--t2);white-space:nowrap}
#db-wrap{overflow:auto;max-height:calc(100vh - 170px)}
#db-wrap::-webkit-scrollbar{width:7px;height:7px}
#db-wrap::-webkit-scrollbar-thumb{background:var(--bd);border-radius:4px}
table.dbt{width:100%;border-collapse:collapse;font-size:11px;min-width:900px}
table.dbt th{background:var(--s2);color:var(--t2);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:7px 10px;border-bottom:2px solid var(--bd);text-align:left;position:sticky;top:0;z-index:10;cursor:pointer;user-select:none;white-space:nowrap}
table.dbt th:hover{background:var(--s3);color:var(--t1)}
table.dbt th.sa::after{content:" ▲";color:var(--rdl);font-size:9px}
table.dbt th.sd::after{content:" ▼";color:var(--rdl);font-size:9px}
table.dbt td{padding:5px 10px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:middle}
table.dbt tr:hover td{background:var(--s2)}
table.dbt tr:nth-child(even) td{background:rgba(255,255,255,.01)}
table.dbt tr:nth-child(even):hover td{background:var(--s2)}
td.td-ill{font-family:var(--mono);color:var(--gold);white-space:nowrap;cursor:pointer}
td.td-ill:hover{text-decoration:underline}
td.td-pnum{font-family:var(--mono);color:var(--gold);white-space:nowrap;cursor:pointer}
td.td-pnum:hover{text-decoration:underline;color:#f0d060}
td.td-desc{max-width:220px}
td.td-model{color:var(--bll);font-size:10px}
td.td-qty{text-align:center}
td.td-pos{font-family:var(--mono);color:var(--t3);font-size:10px}
td.td-rem{max-width:150px;color:var(--t3);font-size:10px}

/* ── XREF VIEW ── */
.xref-card{background:var(--s1);border:1px solid var(--bd);border-radius:var(--radius);margin-bottom:14px;overflow:hidden}
.xref-card-hdr{padding:10px 14px;background:var(--s2);border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.xref-pnum{font-family:var(--mono);font-size:14px;color:var(--gold);font-weight:700}
.xref-desc{color:var(--t2);font-size:12px}
.xref-cnt{background:var(--red);color:#fff;border-radius:9px;padding:2px 8px;font-size:10px;margin-left:auto}

/* ── MISC ── */
.empty{text-align:center;padding:50px 20px;color:var(--t3)}
.empty .ico{font-size:40px;margin-bottom:10px}
::-webkit-scrollbar{width:7px;height:7px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#333;border-radius:4px}
::-webkit-scrollbar-thumb:hover{background:#444}
</style>
</head>
<body>

<div id="topbar">
  <div class="brand">
    <span style="font-size:22px">🏎️</span>
    <div><h1>Porsche 944 — Master Parts Database</h1><p>236 Illustrations &middot; All Model Years</p></div>
  </div>
  <div class="vdiv"></div>
  <div id="search-wrap">
    <input id="gsearch" type="text" placeholder="Search part number or description…" autocomplete="off">
    <span class="si">🔍</span>
  </div>
  <div class="nav-area">
    <button class="nb active" onclick="showView('home')">Home</button>
    <button class="nb" onclick="showView('search')">Search</button>
    <button class="nb" onclick="showView('db')">Database</button>
    <div class="vdiv2"></div>
    <div id="year-filters"></div>
  </div>
</div>

<div id="layout">
  <div id="sidebar">
    <div class="sb-hdr">Browse by Section</div>
    <div id="sb-tree"></div>
  </div>
  <div id="content">

    <!-- HOME -->
    <div id="home-view" class="view active">
      <div class="hero">
        <h2>Porsche <span>944</span> Master Parts Database</h2>
        <p>Comprehensive parts reference compiled from four factory catalog editions spanning the full production run. Each illustration shows parts from all years with supersession notes and year availability.</p>
        <div class="stats-row" id="home-stats"></div>
      </div>
      <div class="home-sec">
        <h3>Browse by Main Group</h3>
        <div class="mg-cards" id="home-mg-cards"></div>
      </div>
    </div>

    <!-- ILLUSTRATION -->
    <div id="ill-view" class="view">
      <div id="ill-hdr-wrap"></div>
      <div id="ill-parts-wrap"></div>
    </div>

    <!-- SEARCH -->
    <div id="search-view" class="view">
      <div class="srch-hdr">
        <h2>Search Results</h2>
        <div class="srch-info" id="srch-info"></div>
      </div>
      <div id="srch-results"></div>
    </div>

    <!-- DATABASE -->
    <div id="db-view" class="view">
      <div class="db-hdr">
        <h2>Parts Database</h2>
        <div class="flt-grp"><label>Group:</label>
          <select id="db-mg" class="fsel" onchange="dbFilter()"><option value="">All Groups</option></select>
        </div>
        <div class="flt-grp"><label>Year:</label>
          <select id="db-cat" class="fsel" onchange="dbFilter()"><option value="">All Years</option></select>
        </div>
        <div class="flt-grp"><label>Filter:</label>
          <input id="db-txt" class="finput" placeholder="Part # or description…" oninput="dbFilter()">
        </div>
        <span class="db-cnt" id="db-cnt"></span>
      </div>
      <div id="db-wrap">
        <table class="dbt" id="dbt">
          <thead><tr>
            <th onclick="dbSort('ill')" data-c="ill">Illustration</th>
            <th onclick="dbSort('mg')"  data-c="mg">Grp</th>
            <th onclick="dbSort('pos')" data-c="pos">Pos</th>
            <th onclick="dbSort('pnum')"data-c="pnum">Part Number</th>
            <th onclick="dbSort('desc')"data-c="desc">Description</th>
            <th onclick="dbSort('qty')" data-c="qty" style="text-align:center">Qty</th>
            <th onclick="dbSort('model')"data-c="model">Model</th>
            <th onclick="dbSort('remark')"data-c="remark">Remark</th>
            <th>Links</th>
          </tr></thead>
          <tbody id="dbt-body"></tbody>
        </table>
      </div>
    </div>


  </div>
</div>

<script>
// ── DATA ────────────────────────────────────────────────────────────────────
const D = """ + js_data + r""";

// D.ills[illId] = {mg, sg, ti(tle), cm(cat mask), g(roups): [[pos,desc,[variants]]]}
// variant = [pnum, qty, model, remark, catmask, superseded_by]
// D.cats  = ['1985_eur','1985_uscan','1988','1991']
// D.catmeta[catId] = {label, color, pdf_dir}
// D.mg[str] = name

const CAT_ORDER = D.cats;
const ILL_ORDER = Object.keys(D.ills).sort();

// ── YEAR FILTER STATE ───────────────────────────────────────────────────────
let activeCat = '';   // '' = all years; else catId string

// ── URL HELPERS (spaces as %20, never +) ───────────────────────────────────
function ebayUrl(pnum){
  return 'https://www.ebay.com/sch/i.html?_nkw='+encodeURIComponent(pnum);
}
function pdfUrl(illId, catId){
  const c = catId||activeCat||'1988';
  const m = D.catmeta[c]||D.catmeta['1988'];
  return m.pdf_dir+'/'+illId+'.pdf';
}
function linksHtml(pnum){
  return '<a class="act-btn eb" href="'+ebayUrl(pnum)+'" target="_blank" title="Search eBay">🛒</a>';
}

// ── YEAR BADGES ─────────────────────────────────────────────────────────────
function catBadge(cid, dim){
  const m=D.catmeta[cid];
  return `<span class="yb${dim?' yb-dim':''}" style="background:${m.color}">${m.label}</span>`;
}
function catBadgesForMask(mask){
  return CAT_ORDER.map((c,i)=> catBadge(c, !(mask&(1<<i)))).join('');
}
function catBadgesActive(mask){
  // only show badges for cats in mask; dim if not matching active filter
  return CAT_ORDER.map((c,i)=>{
    if(!(mask&(1<<i))) return '';
    const dim = activeCat && activeCat!==c;
    return catBadge(c, dim);
  }).join('');
}

// ── UTILS ───────────────────────────────────────────────────────────────────
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function hl(text, q){
  if(!q||q.length<2) return esc(text);
  return esc(text).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'), m=>`<span class="hl">${m}</span>`);
}
function varInActiveCat(v){
  if(!activeCat) return true;
  const idx=CAT_ORDER.indexOf(activeCat);
  return idx>=0 && !!(v[4]&(1<<idx));
}
function illInActiveCat(ill){
  if(!activeCat) return true;
  const idx=CAT_ORDER.indexOf(activeCat);
  return idx>=0 && !!(ill.cm&(1<<idx));
}

// ── YEAR FILTER PILLS ───────────────────────────────────────────────────────
function buildYearFilters(){
  const el=document.getElementById('year-filters');
  let h='<button class="yf on" style="background:#555;border-color:#777" onclick="setYear(\'\')">All Years</button>';
  CAT_ORDER.forEach(cid=>{
    const m=D.catmeta[cid];
    h+=`<button class="yf" style="border-color:${m.color}" onclick="setYear('${cid}')" id="yf-${cid}">${m.label}</button>`;
  });
  el.innerHTML=h;
}
function setYear(cid){
  activeCat=cid;
  document.querySelectorAll('.yf').forEach(b=>{
    b.classList.remove('on');
    b.style.background='';
  });
  const active = cid ? document.getElementById('yf-'+cid) : document.querySelector('.yf');
  if(active){
    active.classList.add('on');
    active.style.background = cid ? D.catmeta[cid].color : '#555';
  }
  // Re-render current view
  if(currentIll) renderIll(currentIll);
  if(dbBuilt) dbFilter();
}

// ── VIEW SWITCHING ───────────────────────────────────────────────────────────
let currentView='home', currentIll=null;
function showView(v){
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  document.getElementById(v+'-view').classList.add('active');
  document.querySelectorAll('.nb').forEach(b=>{
    const t=b.textContent.trim().toLowerCase();
    b.classList.toggle('active',
      (v==='home'&&t==='home')||(v==='search'&&t==='search')||
      (v==='db'&&t==='database'));
  });
  currentView=v;
  if(v==='db') initDb();
}

// ── HOME ─────────────────────────────────────────────────────────────────────
function initHome(){
  let totalVariants=0, uniquePnums=new Set();
  for(const [,ill] of Object.entries(D.ills))
    for(const g of ill.g) for(const v of g[2]){totalVariants++;uniquePnums.add(v[0]);}
  const supCount=Object.values(D.ills).reduce((s,ill)=>s+ill.g.reduce((s2,g)=>s2+g[2].filter(v=>v[5]).length,0),0);
  document.getElementById('home-stats').innerHTML=[
    [ILL_ORDER.length,'Illustrations'],
    [uniquePnums.size.toLocaleString(),'Unique Part Numbers'],
    [totalVariants.toLocaleString(),'Total Part Listings'],
    [supCount.toLocaleString(),'Supersession Links'],
    [CAT_ORDER.length,'Catalog Editions'],
  ].map(([n,l])=>`<div class="stat"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`).join('');

  const mgCounts={};
  for(const ill of Object.values(D.ills)){
    mgCounts[ill.mg]=(mgCounts[ill.mg]||0)+ill.g.reduce((s,g)=>s+g[2].length,0);
  }
  document.getElementById('home-mg-cards').innerHTML=Object.entries(D.mg).map(([mg,name])=>
    `<div class="mg-card" onclick="expandMg(${mg})">
      <div class="mg-card-n">${mg}</div>
      <div class="mg-card-t"><div class="name">${esc(name)}</div><div class="cnt">${(mgCounts[+mg]||0).toLocaleString()} listings</div></div>
    </div>`
  ).join('');
}
function expandMg(mg){
  const el=document.querySelector(`.mg-grp[data-mg="${mg}"]`);
  if(el&&!el.classList.contains('open')) el.classList.add('open');
  const first=ILL_ORDER.find(id=>D.ills[id].mg===+mg);
  if(first) navIll(first);
}

// ── SIDEBAR ──────────────────────────────────────────────────────────────────
function buildSidebar(){
  const tree={};
  for(const id of ILL_ORDER){
    const ill=D.ills[id];
    if(!tree[ill.mg]) tree[ill.mg]={};
    if(!tree[ill.mg][ill.sg]) tree[ill.mg][ill.sg]=[];
    tree[ill.mg][ill.sg].push(id);
  }
  let h='';
  for(const mg of Object.keys(tree).map(Number).sort()){
    const name=D.mg[String(mg)]||'Group '+mg;
    h+=`<div class="mg-grp" data-mg="${mg}">
      <div class="mg-hdr" onclick="this.closest('.mg-grp').classList.toggle('open')">
        <span class="mg-num">${mg}</span><span>${esc(name)}</span><span class="mg-chv">▶</span>
      </div><div class="sg-list">`;
    for(const sg of Object.keys(tree[mg]).map(Number).sort()){
      const ills=tree[mg][sg];
      const sgTitle=D.ills[ills[0]].ti||'SG '+sg;
      h+=`<div class="sg-itm"><div class="sg-hdr" onclick="this.closest('.sg-itm').classList.toggle('open')">
        <span style="color:var(--t3);font-size:10px;font-family:var(--mono)">${String(sg).padStart(2,'0')}</span>
        <span>${esc(sgTitle)}</span><span class="sg-chv">▶</span>
      </div><div class="ill-list">`;
      for(const id of ills){
        h+=`<div class="ill-lnk" id="sl-${id}" onclick="navIll('${id}')">
          <span class="ill-badge">${id}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(D.ills[id].ti)}</span>
        </div>`;
      }
      h+=`</div></div>`;
    }
    h+=`</div></div>`;
  }
  document.getElementById('sb-tree').innerHTML=h;
}

// ── ILLUSTRATION VIEW ─────────────────────────────────────────────────────────
function navIll(illId){
  currentIll=illId;
  showView('ill');
  document.querySelectorAll('.ill-lnk').forEach(l=>l.classList.remove('active'));
  const lnk=document.getElementById('sl-'+illId);
  if(lnk){
    lnk.classList.add('active');
    lnk.closest('.sg-itm').classList.add('open');
    lnk.closest('.mg-grp').classList.add('open');
    lnk.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  renderIll(illId);
  document.getElementById('content').scrollTo(0,0);
}
function renderIll(illId){
  const ill=D.ills[illId];
  if(!ill){document.getElementById('ill-hdr-wrap').innerHTML='<div class="empty"><div class="ico">📭</div><p>Illustration not found.</p></div>';return;}
  const idx=ILL_ORDER.indexOf(illId);
  const prev=idx>0?ILL_ORDER[idx-1]:null;
  const next=idx<ILL_ORDER.length-1?ILL_ORDER[idx+1]:null;
  const mgName=D.mg[String(ill.mg)]||'Group '+ill.mg;
  // pick best cat for pdf link
  const pdfCat = activeCat && (ill.cm&(1<<CAT_ORDER.indexOf(activeCat))) ? activeCat : CAT_ORDER.slice().reverse().find(c=>ill.cm&(1<<CAT_ORDER.indexOf(c)));
  const catStr=pdfUrl(illId,pdfCat);
  const availBadges=CAT_ORDER.map((c,i)=>ill.cm&(1<<i)?catBadge(c,activeCat&&activeCat!==c):'').join('');

  document.getElementById('ill-hdr-wrap').innerHTML=`
    <div class="ill-hdr">
      <div class="ill-hdr-info">
        <h2>Illustration ${illId} — ${esc(ill.ti)}</h2>
        <div class="ill-meta">
          <span class="tag mg-tag">MG ${ill.mg}: ${esc(mgName)}</span>
          <span class="tag">SG ${String(ill.sg).padStart(2,'0')}</span>
          <span class="tag">${ill.g.length} part slots · ${ill.g.reduce((s,g)=>s+g[2].length,0)} listings</span>
        </div>
        <div class="ill-avail">Available in: ${availBadges}</div>
        <div class="ill-actions">
          <a class="act-btn pdf" href="${catStr}" target="_blank">📄 Open PDF</a>
        </div>
      </div>
      <div class="ill-nav-btns">
        ${prev?`<button class="inb" onclick="navIll('${prev}')">← ${prev}</button>`:''}
        ${next?`<button class="inb" onclick="navIll('${next}')">${next} →</button>`:''}
      </div>
    </div>`;

  renderPartsTable(illId, ill, '');
}
function renderPartsTable(illId, ill, query){
  if(!ill.g.length){
    document.getElementById('ill-parts-wrap').innerHTML='<div class="empty"><div class="ico">📦</div><p>No parts data.</p></div>';
    return;
  }
  const catIdx=activeCat?CAT_ORDER.indexOf(activeCat):-1;
  let h=`<div class="pt-wrap"><table class="pt">
    <thead><tr>
      <th style="width:44px">Pos</th>
      <th style="width:155px">Part Number</th>
      <th>Description</th>
      <th style="width:44px;text-align:center">Qty</th>
      <th style="width:90px">Model</th>
      <th style="width:150px">Remark</th>
      <th style="width:52px">Links</th>
    </tr></thead><tbody>`;

  // Group ill.g entries by pos, preserving order
  const byPos={}, posOrder=[];
  for(const g of ill.g){
    const [pos,desc,variants]=g;
    if(!byPos[pos]){byPos[pos]=[];posOrder.push(pos);}
    byPos[pos].push([desc,variants]);
  }

  for(const pos of posOrder){
    const descGroups=byPos[pos];

    // Filter each desc group's variants for active catalog
    const filtered=descGroups.map(([desc,variants])=>{
      const vis=variants.filter(v=>!activeCat||(v[4]&(1<<catIdx)));
      return [desc,variants,vis];
    }).filter(([d,v,vis])=>vis.length>0);
    if(!filtered.length) continue;

    // CASE 1: single desc group, single variant, no supersession → compact row
    if(filtered.length===1){
      const [desc,variants,vis]=filtered[0];
      if(variants.length===1&&!variants[0][5]){
        const v=variants[0];
        const dim=activeCat&&!(v[4]&(1<<catIdx));
        h+=`<tr class="single" style="${dim?'opacity:.35':''}">
          <td class="pos-cell">${esc(pos)}</td>
          <td><span class="pnum" onclick="xrefOpen('${esc(v[0])}')">${hl(v[0],query)}</span></td>
          <td>${hl(desc,query)}</td>
          <td class="qty-cell">${esc(v[1])}</td>
          <td class="model-cell">${esc(v[2])}</td>
          <td class="remark-cell">${hl(v[3],query)}</td>
          <td class="links-cell">${linksHtml(v[0])}</td>
        </tr>`;
        continue;
      }
    }

    // CASE 2: multiple desc groups OR a desc group with multiple/superseded variants
    // No separate header row — pos shown once in the pos cell of the first row,
    // with a border-top separator. Subsequent rows leave pos cell blank.
    let firstInPos=true;
    const posCell=()=>{
      const c=firstInPos?`<td class="pos-cell">${esc(pos)}</td>`:`<td class="pos-cell"></td>`;
      firstInPos=false;
      return c;
    };
    const firstCls=()=>firstInPos?' pos-first':'';  // called before posCell

    for(const [desc,variants,vis] of filtered){
      const needsDescHdr=variants.length>1||!!variants[0][5];

      if(!needsDescHdr){
        // Single variant — one inline row
        const v=variants[0];
        const notInCat=activeCat&&!(v[4]&(1<<catIdx));
        const dim=notInCat||!!v[5];
        const fc=firstCls();
        h+=`<tr class="pos-single${fc}" style="${dim?'opacity:.45':''}">
          ${posCell()}
          <td><span class="pnum" onclick="xrefOpen('${esc(v[0])}')">${hl(v[0],query)}</span></td>
          <td>${hl(desc,query)}</td>
          <td class="qty-cell">${esc(v[1])}</td>
          <td class="model-cell">${esc(v[2])}</td>
          <td class="remark-cell">${hl(v[3],query)}</td>
          <td class="links-cell">${linksHtml(v[0])}</td>
        </tr>`;
      } else {
        // Multiple variants — desc sub-header, then active variants with
        // superseded predecessors listed beneath each active one
        const fc=firstCls();
        h+=`<tr class="desc-hdr${fc}">${posCell()}<td colspan="6"><span class="grp-desc">${hl(desc,query)}</span></td></tr>`;
        // Build reverse map: newPnum → [oldVariants that were superseded by it]
        const predMap={};
        for(const v of variants) if(v[5]){(predMap[v[5]]=predMap[v[5]]||[]).push(v);}
        const activeVars=variants.filter(v=>!v[5]);
        const orphans=variants.filter(v=>v[5]&&!activeVars.find(a=>a[0]===v[5]));
        // Render active variants first
        for(const v of activeVars){
          const notInCat=activeCat&&!(v[4]&(1<<catIdx));
          if(notInCat) continue;
          h+=`<tr class="variant lvl2">
            <td class="pos-cell"></td>
            <td><span class="pnum" onclick="xrefOpen('${esc(v[0])}')">${hl(v[0],query)}</span></td>
            <td></td>
            <td class="qty-cell">${esc(v[1])}</td>
            <td class="model-cell">${esc(v[2])}</td>
            <td class="remark-cell">${esc(v[3])}</td>
            <td class="links-cell">${linksHtml(v[0])}</td>
          </tr>`;
          for(const old of (predMap[v[0]]||[])){
            h+=`<tr class="sup-pred">
              <td></td>
              <td><span class="sup-label">replaces</span><span class="pnum sup-pnum" onclick="xrefOpen('${esc(old[0])}')" title="Superseded">${esc(old[0])}</span></td>
              <td></td><td></td>
              <td class="model-cell">${esc(old[2])}</td>
              <td class="remark-cell">${esc(old[3])}</td>
              <td></td>
            </tr>`;
          }
        }
        for(const v of orphans){
          const notInCat=activeCat&&!(v[4]&(1<<catIdx));
          if(notInCat) continue;
          h+=`<tr class="variant lvl2 sup">
            <td class="pos-cell"></td>
            <td><span class="pnum sup-pnum">${esc(v[0])}</span><span class="sup-arrow">→</span><span class="pnum" onclick="xrefOpen('${esc(v[5])}')">${esc(v[5])}</span></td>
            <td></td>
            <td class="qty-cell">${esc(v[1])}</td>
            <td class="model-cell">${esc(v[2])}</td>
            <td class="remark-cell">${esc(v[3])}</td>
            <td></td>
          </tr>`;
        }
      }
    }
  }
  h+='</tbody></table></div>';
  document.getElementById('ill-parts-wrap').innerHTML=h;
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
let searchTimer=null;
function triggerSearch(){
  const q=document.getElementById('gsearch').value.trim();
  if(!q) return;
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>doSearch(q),300);
}
document.getElementById('gsearch').addEventListener('keydown',e=>{if(e.key==='Enter'){clearTimeout(searchTimer);doSearch(document.getElementById('gsearch').value.trim());}});
document.getElementById('gsearch').addEventListener('input',triggerSearch);

function doSearch(query){
  if(!query) return;
  showView('search');
  const q=query.toLowerCase();
  const catIdx=activeCat?CAT_ORDER.indexOf(activeCat):-1;

  // Collect matches grouped by illustration → pos → desc
  // grouped[illId] = { byPos:{pos:[{desc,variants}]}, posOrder:[], matchCount }
  const grouped={};
  for(const illId of ILL_ORDER){
    const ill=D.ills[illId];
    if(activeCat&&!(ill.cm&(1<<catIdx))) continue;
    const byPos={}, posOrder=[];
    let matchCount=0;
    for(const g of ill.g){
      const [pos,desc,variants]=g;
      const descMatch=desc.toLowerCase().includes(q);
      // Collect matching variants for this (pos,desc)
      const matchingVariants=variants.filter(v=>{
        if(activeCat&&!(v[4]&(1<<catIdx))) return false;
        return v[0].toLowerCase().includes(q)||descMatch||v[3].toLowerCase().includes(q)||v[2].toLowerCase().includes(q);
      });
      if(!matchingVariants.length) continue;
      if(!byPos[pos]){byPos[pos]=[];posOrder.push(pos);}
      byPos[pos].push({desc, variants:matchingVariants});
      matchCount+=matchingVariants.length;
    }
    if(posOrder.length) grouped[illId]={byPos,posOrder,matchCount};
  }

  const ills=Object.keys(grouped);
  const total=ills.reduce((s,k)=>s+grouped[k].matchCount,0);
  document.getElementById('srch-info').textContent=`${total} match${total!==1?'es':''} in ${ills.length} illustration${ills.length!==1?'s':''} for "${query}"`;

  if(!ills.length){
    document.getElementById('srch-results').innerHTML='<div class="empty"><div class="ico">🔍</div><p>No results.</p></div>';
    return;
  }

  let h='';
  for(const illId of ills){
    const ill=D.ills[illId];
    const {byPos,posOrder,matchCount}=grouped[illId];
    const pdfCat=activeCat||CAT_ORDER.slice().reverse().find(c=>ill.cm&(1<<CAT_ORDER.indexOf(c)));
    h+=`<div class="srch-group">
      <div class="srch-group-hdr" onclick="navIll('${illId}')">
        <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--t1)">${illId}</span>
            <span style="font-size:14px;font-weight:700;color:var(--t1)">${esc(ill.ti)}</span>
            <span class="srch-cnt">${matchCount}</span>
          </div>
          <div style="font-size:10px;color:var(--t3)">${esc(D.mg[String(ill.mg)]||'')}</div>
        </div>
        <a class="act-btn pdf" href="${pdfUrl(illId,pdfCat)}" target="_blank" onclick="event.stopPropagation()">📄 PDF</a>
      </div>
      <div class="pt-wrap"><table class="pt">
        <thead><tr>
          <th style="width:44px">Pos</th><th style="width:155px">Part Number</th>
          <th>Description</th><th style="width:44px;text-align:center">Qty</th>
          <th style="width:90px">Model</th><th style="width:150px">Remark</th>
          <th style="width:52px">Links</th>
        </tr></thead><tbody>`;

    for(const pos of posOrder){
      const descGroups=byPos[pos];
      // CASE 1: single desc group, single variant, no supersession → compact row
      if(descGroups.length===1&&descGroups[0].variants.length===1&&!descGroups[0].variants[0][5]){
        const {desc,variants}=descGroups[0];
        const v=variants[0];
        h+=`<tr class="single">
          <td class="pos-cell">${esc(pos)}</td>
          <td><span class="pnum" onclick="xrefOpen('${esc(v[0])}')">${hl(v[0],query)}</span></td>
          <td>${hl(desc,query)}</td>
          <td class="qty-cell">${esc(v[1])}</td>
          <td class="model-cell">${esc(v[2])}</td>
          <td class="remark-cell">${hl(v[3],query)}</td>
          <td class="links-cell">${linksHtml(v[0])}</td>
        </tr>`;
      } else {
        // CASE 2: pos shown once in first row's pos cell, with separator border
        let firstInPos=true;
        const posCell=()=>{
          const c=firstInPos?`<td class="pos-cell">${esc(pos)}</td>`:`<td class="pos-cell"></td>`;
          firstInPos=false; return c;
        };
        const firstCls=()=>firstInPos?' pos-first':'';
        for(const {desc,variants} of descGroups){
          if(variants.length===1&&!variants[0][5]){
            const v=variants[0];
            const fc=firstCls();
            h+=`<tr class="pos-single${fc}">
              ${posCell()}
              <td><span class="pnum" onclick="xrefOpen('${esc(v[0])}')">${hl(v[0],query)}</span></td>
              <td>${hl(desc,query)}</td>
              <td class="qty-cell">${esc(v[1])}</td>
              <td class="model-cell">${esc(v[2])}</td>
              <td class="remark-cell">${hl(v[3],query)}</td>
              <td class="links-cell">${linksHtml(v[0])}</td>
            </tr>`;
          } else {
            const fc=firstCls();
            h+=`<tr class="desc-hdr${fc}">${posCell()}<td colspan="6"><span class="grp-desc">${hl(desc,query)}</span></td></tr>`;
            const predMap={};
            for(const v of variants) if(v[5]){(predMap[v[5]]=predMap[v[5]]||[]).push(v);}
            const activeVars=variants.filter(v=>!v[5]);
            const orphans=variants.filter(v=>v[5]&&!activeVars.find(a=>a[0]===v[5]));
            for(const v of activeVars){
              h+=`<tr class="variant lvl2">
                <td class="pos-cell"></td>
                <td><span class="pnum" onclick="xrefOpen('${esc(v[0])}')">${hl(v[0],query)}</span></td>
                <td></td>
                <td class="qty-cell">${esc(v[1])}</td>
                <td class="model-cell">${esc(v[2])}</td>
                <td class="remark-cell">${hl(v[3],query)}</td>
                <td class="links-cell">${linksHtml(v[0])}</td>
              </tr>`;
              for(const old of (predMap[v[0]]||[])){
                h+=`<tr class="sup-pred">
                  <td></td>
                  <td><span class="sup-label">replaces</span><span class="pnum sup-pnum" onclick="xrefOpen('${esc(old[0])}')">${hl(old[0],query)}</span></td>
                  <td></td><td></td>
                  <td class="model-cell">${esc(old[2])}</td>
                  <td class="remark-cell">${esc(old[3])}</td>
                  <td></td>
                </tr>`;
              }
            }
            for(const v of orphans){
              h+=`<tr class="variant lvl2 sup">
                <td class="pos-cell"></td>
                <td><span class="pnum sup-pnum">${hl(v[0],query)}</span><span class="sup-arrow">→</span><span class="pnum" onclick="xrefOpen('${esc(v[5])}')">${esc(v[5])}</span></td>
                <td></td>
                <td class="qty-cell">${esc(v[1])}</td>
                <td class="model-cell">${esc(v[2])}</td>
                <td class="remark-cell">${hl(v[3],query)}</td>
                <td></td>
              </tr>`;
            }
          }
        }
      }
    }
    h+='</tbody></table></div></div>';
  }
  document.getElementById('srch-results').innerHTML=h;
  document.getElementById('content').scrollTo(0,0);
}

// ── DATABASE ──────────────────────────────────────────────────────────────────
let dbBuilt=false, dbRows=[], dbFiltered=[], dbSortCol='ill', dbSortDir=1;

function initDb(){
  if(dbBuilt) return;
  dbBuilt=true;
  // Build flat rows
  for(const illId of ILL_ORDER){
    const ill=D.ills[illId];
    for(const g of ill.g){
      const [pos,desc,variants]=g;
      for(const v of variants){
        dbRows.push({
          ill:illId, mg:ill.mg, sg:ill.sg, pos, desc,
          pnum:v[0], qty:v[1], model:v[2], remark:v[3],
          catmask:v[4], sup:v[5]||''
        });
      }
    }
  }
  // Populate selects
  const mgSel=document.getElementById('db-mg');
  [...new Set(dbRows.map(r=>r.mg))].sort((a,b)=>a-b).forEach(mg=>{
    const o=document.createElement('option');o.value=mg;o.textContent=`MG ${mg}: ${D.mg[String(mg)]||mg}`;mgSel.appendChild(o);
  });
  const catSel=document.getElementById('db-cat');
  CAT_ORDER.forEach(cid=>{
    const o=document.createElement('option');o.value=cid;o.textContent=D.catmeta[cid].label;catSel.appendChild(o);
  });
  dbFilter();
}

function dbFilter(){
  const txt=(document.getElementById('db-txt')?.value||'').toLowerCase().trim();
  const mgF=document.getElementById('db-mg')?.value;
  const catF=document.getElementById('db-cat')?.value||'';
  const catIdx=catF?CAT_ORDER.indexOf(catF):-1;
  dbFiltered=dbRows.filter(r=>{
    if(mgF!==''&&r.mg!==+mgF) return false;
    if(catF&&!(r.catmask&(1<<catIdx))) return false;
    if(txt&&!r.pnum.toLowerCase().includes(txt)&&!r.desc.toLowerCase().includes(txt)&&
       !r.ill.toLowerCase().includes(txt)&&!r.remark.toLowerCase().includes(txt)) return false;
    return true;
  });
  dbSortAndRender();
}
function dbSort(col){
  if(dbSortCol===col){dbSortDir=-dbSortDir;}else{dbSortCol=col;dbSortDir=1;}
  document.querySelectorAll('#dbt th[data-c]').forEach(th=>{
    th.classList.remove('sa','sd');
    if(th.dataset.c===col) th.classList.add(dbSortDir===1?'sa':'sd');
  });
  dbSortAndRender();
}
function dbSortAndRender(){
  const c=dbSortCol,d=dbSortDir;
  const sorted=[...dbFiltered].sort((a,b)=>{
    let av=a[c]||'',bv=b[c]||'';
    if(c==='mg'||c==='sg'){av=+av;bv=+bv;}
    if(c==='qty'){av=av==='X'?999:+av||0;bv=bv==='X'?999:+bv||0;}
    return av<bv?-d:av>bv?d:0;
  });
  const txt=document.getElementById('db-txt')?.value.trim()||'';
  document.getElementById('db-cnt').textContent=`${sorted.length.toLocaleString()} of ${dbRows.length.toLocaleString()} listings`;
  const lim=Math.min(sorted.length,5000);
  let h='';
  for(let i=0;i<lim;i++){
    const r=sorted[i];
    const isSup=!!r.sup;
    const bestCat=activeCat||(CAT_ORDER.slice().reverse().find(c=>r.catmask&(1<<CAT_ORDER.indexOf(c)))||'1988');
    h+=`<tr style="${isSup?'opacity:.45':''}">
      <td class="td-ill" onclick="navIll('${r.ill}')">${r.ill}</td>
      <td class="td-mg"><span class="mg-num" style="font-size:9px;padding:1px 4px">${r.mg}</span></td>
      <td class="td-pos">${esc(r.pos)}</td>
      <td class="td-pnum" onclick="xrefOpen('${esc(r.pnum)}')">${hl(r.pnum,txt)}${isSup?` <span style="font-size:9px;color:var(--t3)">→ ${esc(r.sup)}</span>`:''}</td>
      <td class="td-desc">${hl(r.desc,txt)}</td>
      <td class="td-qty">${esc(r.qty)}</td>
      <td class="td-model">${esc(r.model)}</td>
      <td class="td-rem">${hl(r.remark,txt)}</td>
      <td style="white-space:nowrap">
        <a class="act-btn pdf" href="${pdfUrl(r.ill,bestCat)}" target="_blank">📄</a>
        <a class="act-btn eb"  href="${ebayUrl(r.pnum)}" target="_blank">🛒</a>
      </td>
    </tr>`;
  }
  if(sorted.length>5000) h+=`<tr><td colspan="9" style="text-align:center;padding:10px;color:var(--t3);font-size:11px">Showing 5,000 of ${sorted.length.toLocaleString()} — refine filters to see more.</td></tr>`;
  document.getElementById('dbt-body').innerHTML=h;
}

// Clicking a part number searches for it
function xrefOpen(pnum){
  document.getElementById('gsearch').value=pnum;
  doSearch(pnum);
}

// ── INIT ──────────────────────────────────────────────────────────────────────
buildYearFilters();
buildSidebar();
initHome();
</script>
</body>
</html>"""

out = BASE + '/porsche944_catalog.html'
with open(out,'w',encoding='utf-8') as f:
    f.write(HTML)
sz = os.path.getsize(out)
print(f"Written: {sz:,} bytes ({sz/1024/1024:.1f} MB)")

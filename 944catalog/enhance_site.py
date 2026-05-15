# Read the existing site
with open('/sessions/festive-keen-bardeen/mnt/outputs/porsche944_catalog.html', 'r') as f:
    html = f.read()

# 1. Add a "cross-reference" feature: shows all illustrations a part number appears in
# 2. Add a "part detail" modal
# 3. Improve the nav to include Browse

# Add cross-reference button to nav
html = html.replace(
    '<button class="nav-btn" onclick="showView(\'db\')">Database</button>',
    '''<button class="nav-btn" onclick="showView('db')">Database</button>
    <button class="nav-btn" onclick="showView('xref')">Cross-Ref</button>'''
)

# Add cross-ref view HTML after db-view
html = html.replace(
    '</div><!-- /content -->',
    '''
    <!-- CROSS-REFERENCE VIEW -->
    <div id="xref-view" class="view">
      <div style="margin-bottom:20px">
        <h2 style="font-size:20px;font-weight:700;margin-bottom:8px">Part Number Cross-Reference</h2>
        <p style="color:var(--text2);font-size:13px;margin-bottom:16px">Enter a part number to find all illustrations where it appears.</p>
        <div style="display:flex;gap:10px;align-items:center">
          <input type="text" id="xref-input" class="db-input" style="min-width:280px;font-family:var(--mono)" placeholder="e.g. 944 721 027 05" oninput="doXref()">
          <span id="xref-badge" style="font-size:12px;color:var(--text3)"></span>
        </div>
      </div>
      <div id="xref-results"></div>
    </div>

  </div><!-- /content -->'''
)

# Add xref JavaScript before the closing </script>
xref_js = '''
// ============================================================
// CROSS-REFERENCE
// ============================================================
function doXref() {
  const q = document.getElementById('xref-input').value.trim().toLowerCase();
  const resultsEl = document.getElementById('xref-results');
  const badgeEl = document.getElementById('xref-badge');
  
  if (q.length < 3) {
    resultsEl.innerHTML = '';
    badgeEl.textContent = '';
    return;
  }
  
  // Find exact or partial matches
  const matches = ALL_PARTS.filter(p => p.pnum.toLowerCase().includes(q));
  const grouped = {};
  for (const p of matches) {
    const key = p.pnum;
    if (!grouped[key]) grouped[key] = { pnum: p.pnum, desc: p.desc, occurrences: [] };
    grouped[key].occurrences.push({ ill: p.ill, ill_title: p.ill_title, pos: p.pos, qty: p.qty, model: p.model, mg: p.mg, mg_name: p.mg_name });
  }
  
  const pnums = Object.keys(grouped);
  badgeEl.textContent = `${pnums.length} part number(s) found`;
  
  if (!pnums.length) {
    resultsEl.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>No parts found matching "<strong>${escHtml(q)}</strong>"</p></div>`;
    return;
  }
  
  let html = '';
  for (const pnum of pnums.sort()) {
    const g = grouped[pnum];
    const pp_url = pnumToLink(pnum);
    const eb_url = pnumToEbay(pnum);
    html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:16px;overflow:hidden">
      <div style="padding:14px 16px;background:var(--surface2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-family:var(--mono);font-size:15px;color:var(--gold);font-weight:700">${highlightText(pnum, q)}</span>
        <span style="color:var(--text2);font-size:13px">${escHtml(g.desc)}</span>
        <span style="background:var(--red);color:#fff;border-radius:10px;padding:2px 10px;font-size:11px;margin-left:auto">${g.occurrences.length} occurrence${g.occurrences.length !== 1 ? 's' : ''}</span>
        <a class="pelican-btn" href="${pp_url}" target="_blank">🔧 PelicanParts</a>
        <a class="pelican-btn" href="${eb_url}" target="_blank">🛒 eBay</a>
      </div>
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <thead><tr>
          <th style="padding:8px 12px;background:rgba(0,0,0,0.3);color:var(--text3);text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.05em">Illustration</th>
          <th style="padding:8px 12px;background:rgba(0,0,0,0.3);color:var(--text3);text-align:left;font-size:11px;text-transform:uppercase">Section</th>
          <th style="padding:8px 12px;background:rgba(0,0,0,0.3);color:var(--text3);text-align:left;font-size:11px;text-transform:uppercase">Group</th>
          <th style="padding:8px 12px;background:rgba(0,0,0,0.3);color:var(--text3);text-align:left;font-size:11px;text-transform:uppercase">Pos</th>
          <th style="padding:8px 12px;background:rgba(0,0,0,0.3);color:var(--text3);text-align:center;font-size:11px;text-transform:uppercase">Qty</th>
          <th style="padding:8px 12px;background:rgba(0,0,0,0.3);color:var(--text3);text-align:left;font-size:11px;text-transform:uppercase">Model</th>
        </tr></thead>
        <tbody>`;
    for (const occ of g.occurrences) {
      html += `<tr style="cursor:pointer" onclick="navigateToIll('${occ.ill}')" title="Open illustration ${occ.ill}">
        <td style="padding:7px 12px;border-bottom:1px solid rgba(255,255,255,0.04);font-family:var(--mono);color:var(--gold)">${occ.ill}</td>
        <td style="padding:7px 12px;border-bottom:1px solid rgba(255,255,255,0.04)">${escHtml(occ.ill_title)}</td>
        <td style="padding:7px 12px;border-bottom:1px solid rgba(255,255,255,0.04);color:var(--text3);font-size:11px">${escHtml(occ.mg_name)}</td>
        <td style="padding:7px 12px;border-bottom:1px solid rgba(255,255,255,0.04);font-family:var(--mono);color:var(--text3)">${escHtml(occ.pos)}</td>
        <td style="padding:7px 12px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:center">${escHtml(occ.qty)}</td>
        <td style="padding:7px 12px;border-bottom:1px solid rgba(255,255,255,0.04);color:var(--blue-light)">${escHtml(occ.model)}</td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }
  resultsEl.innerHTML = html;
}

// Pressing Enter in xref input also fires doXref
document.getElementById('xref-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') doXref();
});
'''

html = html.replace('// ============================================================\n// INIT', xref_js + '\n// ============================================================\n// INIT')

# Write final file
with open('/sessions/festive-keen-bardeen/mnt/outputs/porsche944_catalog.html', 'w') as f:
    f.write(html)

import os
size = os.path.getsize('/sessions/festive-keen-bardeen/mnt/outputs/porsche944_catalog.html')
print(f"Enhanced file: {size:,} bytes ({size/1024/1024:.1f} MB)")

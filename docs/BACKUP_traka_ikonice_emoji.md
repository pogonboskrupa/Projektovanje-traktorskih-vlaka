# Backup — traka dugmadi PRIJE zamjene emoji → crtane ikonice

Napravljeno prije izmjene u v3.82.0 (commit `2c08922`, index.html ~linija 3377)
kad je odlučeno da se emoji znakovi na glavnoj traci (Meni + 7 tabova) zamijene
crtanim SVG ikonicama (currentColor, prate postojeću boju svakog taba).

## Kako se vratiti na emoji verziju

**Najsigurnije — kroz git** (čuva cijelu historiju, ne samo ovaj blok):
```bash
git log --oneline -- index.html | grep -i "ikonic\|dugmad"   # nađi commit koji je UVEO ikonice
git show <taj-commit-hash> -- index.html                     # pregledaj šta je promijenio
git revert <taj-commit-hash>                                  # napravi novi commit koji ga poništava
```
Ili grublje (vrati SAMO index.html na stanje prije ove izmjene, bez revert commita):
```bash
git checkout 2c08922662066c12b7a8e784b46e7c4ebf43799f -- index.html
```

**Ručno — zalijepi ovaj blok nazad** preko `<div id="tab-bar">...</div>` u
`index.html` (traži `<div id="tab-bar">`):

```html
<div id="tab-bar">
  <button class="tab-btn" id="menu-btn" ontouchstart="toggleMenuDropdown(event)" onclick="toggleMenuDropdown(event)">☰ Meni</button>
  <button class="tab-btn active" onclick="switchTab('karta')">🗺 Karta</button>
  <button class="tab-btn" onclick="switchTab('projekat')">📁 Projekat</button>
  <button class="tab-btn" onclick="switchTab('vlake')">📐 Vlake<span class="tab-notif" id="notif-vlake"></span></button>
  <button class="tab-btn" onclick="switchTab('doznaka')">🌲 Doznaka<span class="tab-notif" id="notif-doznaka"></span></button>
  <button class="tab-btn" id="admin-tab-btn" style="display:none;color:#fbbf24;" onclick="switchTab('admin')">👥 Korisnici<span class="tab-notif" id="notif-admin"></span></button>
  <button class="tab-btn" id="postavke-tab-btn" style="display:none;color:#a78bfa;" onclick="switchTab('postavke')">⚙ Postavke</button>
  <button class="tab-btn" id="teren-tab-btn" style="display:none;color:#34d399;" onclick="switchTab('teren')">🧭 Teren</button>
  <span id="vodeci-badge" onclick="closeMenuDropdown();showProjectManagement()" title="Nadzorni nalog — pregled rada svih projektanata šumarije" style="display:none;background:#0e7490;color:#fff;font-size:10px;font-weight:bold;padding:3px 8px;border-radius:10px;white-space:nowrap;margin-left:auto;flex-shrink:0;align-self:center;cursor:pointer;user-select:none;">👔 VODEĆI PROJEKTANT</span>
  <span id="offline-badge" style="display:none;background:#dc2626;color:#fff;font-size:10px;font-weight:bold;padding:3px 8px;border-radius:10px;white-space:nowrap;margin-left:auto;flex-shrink:0;align-self:center;">📴 OFFLINE</span>
  <span id="sync-badge" onclick="openSyncQueuePanel()" style="display:none;background:#f59e0b;color:#000;font-size:10px;font-weight:bold;padding:3px 8px;border-radius:10px;white-space:nowrap;margin-left:4px;flex-shrink:0;align-self:center;cursor:pointer;user-select:none;" title="Pending operacije čekaju sync">⟳ <span id="sync-badge-cnt">0</span></span>
</div>
```

Napomena: `vodeci-badge` / `offline-badge` / `sync-badge` redovi nisu dirani
izmjenom ikonica (ostaju identični i prije i poslije) — navedeni su ovdje
samo da se cijeli `#tab-bar` blok može zalijepiti u komadu.

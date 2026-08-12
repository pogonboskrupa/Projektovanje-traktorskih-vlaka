# Backup — dugmad u panelima PRIJE zamjene emoji → SVG ikonice

Izmjena napravljena u v3.84.0. Stanje **prije** nje je commit
`154cc3551bc71ba81a2c54038294991c6112c5b8` ("Traka: emoji dugmad → crtane SVG
ikonice (Meni + 7 tabova)").

## Šta je promijenjeno

- Dodan **SVG sprite** odmah iza `<body>` u `index.html` — 65 `<symbol>`
  definicija (`id="ic-NAZIV"`).
- Dodana CSS klasa `.ic` (uz postojeću `.tbi` za traku).
- U **398 mjesta unutar `<button>` elemenata** emoji je zamijenjen sa
  `<svg class="ic"><use href="#ic-NAZIV"/></svg>`.

**Nije dirano:** emoji u toastovima (`showToast`), dijalozima (`_dlgConfirm`,
`_dlgPrompt`), naslovima sekcija, opisima i `title`/`onclick` atributima —
isključivo sadržaj dugmadi.

## Kako se vratiti na emoji verziju

**Najsigurnije — kroz git:**
```bash
# vrati SAMO index.html na stanje prije ove izmjene
git checkout 154cc3551bc71ba81a2c54038294991c6112c5b8 -- index.html
```
Time nestaju i sprite i sve zamjene odjednom, jer je sve u tom jednom fajlu.

**Ili poništi commit** koji je uveo ikonice (zadržava historiju):
```bash
git log --oneline -- index.html | head          # nađi commit "Dugmad u panelima..."
git revert <hash>
```

**Vraćanje SAMO jednog dugmeta** (ako ti smeta pojedina ikonica): zamijeni
`<svg class="ic"><use href="#ic-NAZIV"/></svg>` nazad odgovarajućim emoji —
mapiranje je u tabeli ispod.

## Mapiranje emoji → naziv ikonice

| emoji | `#ic-` naziv | emoji | `#ic-` naziv |
|---|---|---|---|
| ✕ ✖ | zatvori | 🎨 | boja |
| 🗑 | obrisi | 🔧 | alat |
| ✓ ✔ ✅ | potvrdi | 🖨 | stampaj |
| ➕ | dodaj | 🖼 | slika |
| ← | nazad | 🗄 | arhiva |
| → ➜ ➤ | naprijed | ⚙ | postavke |
| ▶ | pocni | ⚡ | brzo |
| ⏸ | pauza | ⊘ | opozovi |
| ⏹ | stop | ↔ | prebaci |
| 🔴 | snimaj | ↕ | visina |
| ↺ ↻ | osvjezi | ↩ | vrati |
| 🔄 | zamijeni | ↪ | ponovi |
| 📥 | uvezi | 🧭 | kompas |
| 📤 | posalji | 🛰 | satelit |
| 💾 | sacuvaj | 📡 | gps |
| 📄 | dokument | ⛰ 🏔 | podloga |
| 📋 | kopiraj | 💧 | pipeta |
| 📂 📁 | folder | 🔲 | buffer |
| 🗂 | slojevi | 📐 | uglomjer |
| ☁ | server | 🎯 | meta |
| ✉ 📨 | mail | 📍 | pozicija |
| 🗺 | karta | 📌 | zabiljezi |
| ✏ ✍ | crtaj | 👁 | prikazi |
| ✋ | rucno | 🙈 | sakrij |
| 👆 | dodir | 🔑 | kljuc |
| 🔍 | trazi | 🔓 | otkljucaj |
| 👤 | korisnik | ✂ | izrezi |
| 📊 | statistika | ✥ | pomjeri |
| 📷 | kamera | ☆ | zvijezda |
| 🏷 | oznaka | 🕒 | vrijeme |
| 📱 | uredjaj | 👣 | trag |
| ⬛ ☐ | kvadrat | ━ | puna |
| ╌ | crtkana | | |

## Napomene za buduće izmjene

- SVG markup u dugmadima **ne smije sadržavati jednostruke navodnike ni
  backtick** — dio dugmadi se gradi unutar JS stringova (`'...'` i `` `...` ``),
  pa bi ih to prekinulo. Zato sve definicije koriste isključivo dvostruke
  navodnike.
- `stroke="currentColor"` u `.ic` klasi znači da ikonica prati boju dugmeta.
  **Ne** hardkodovati boju u `<symbol>` — pokvario bi se taj mehanizam.
- Veličina je u `em` (ne px) da prati `font-size` dugmeta.

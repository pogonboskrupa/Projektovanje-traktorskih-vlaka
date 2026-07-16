# Modularizacija index.html

index.html je ~31k linija sa svim JS-om inline — svaka izmjena je rizik za
cijelu aplikaciju. Razbijanje ide **postepeno**, modul po modul, bez big-bang
rewrite-a.

## Dokazani obrazac (v3.29.0 — offline-layer)

`static/js/offline-layer.js` (_OL + _genUUID) je prvi izdvojeni modul:

1. Kod se izreže **doslovno** (bez izmjena) u `static/js/<modul>.js`.
2. Na ISTOJ poziciji u index.html se veliki `<script>` blok razdvoji:
   `</script><script src="static/js/<modul>.js"></script><script>` —
   redoslijed izvršavanja ostaje identičan; top-level `const/let` iz
   externog fajla su globalno vidljivi narednim skriptama (isto kao prije).
3. Na kraj modula ide Node-guard za testove:
   `if (typeof module !== 'undefined' && module.exports) module.exports = {...}`
4. Modul se doda u `sw.js` APP_SHELL (offline prvi load). `copy-assets`
   skripte već kopiraju cijeli `static/` u APK — ništa dodatno.
5. Testovi u `tests/js/<modul>.test.js` (čist Node, bez zavisnosti):
   `node tests/js/offline-layer.test.js`

## Pravila (naučeno na prvom izvlačenju)

- **Ne izvlačiti kod koji se poziva na top-levelu prije svoje pozicije**
  (init pozivi tipa `updPrev()` odmah po definiciji) bez provjere — hoisting
  funkcija ne prelazi granice script blokova.
- Zavisnosti na globale (showToast, sbUser, map...) su OK dok se pozivaju
  u runtime-u (poslije punog parsiranja) — u testovima se stubuju.
- Jedan modul po PR-u/verziji; poslije svakog: syntax-check svih blokova +
  testovi + ručni smoke na webu.

## Redoslijed kandidata (po izolovanosti/vrijednosti)

1. ✅ `offline-layer.js` — _OL red čekanja (v3.29.0, 13 testova)
2. `geo-utils.js` — dst/haversine, ptAtFrac, calcL, fmtL, bearing, WGS↔GK
   (čiste funkcije, idealne za testove)
3. `gps-pipeline.js` — onP filteri, spike zaštita, simplify (uz testove
   scenarija: spike, skok, min-razmak)
4. `trag-registry.js` — _tragRegistry + stil
5. `stil-linija.js` — _lineStyle + panel
6. `doznaka.js` — najveći, tek kad se obrazac ustali

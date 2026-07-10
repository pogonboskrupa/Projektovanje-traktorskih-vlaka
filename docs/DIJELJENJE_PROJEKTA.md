# Dijeljenje projekta — više projektanata na istom odjelu

Audit i stanje sistema za zajednički rad (vlake + doznaka), v3.28.6.
Pokriva: model podataka, prava pristupa (RLS), sinkronizaciju uživo,
poznata ograničenja i šta je popravljeno u ovom prolazu.

## 1. Model

- **Projekat** (`projekti`): vlasnik = `korisnik_id`. Članovi u
  `projekt_clanovi` (vlasnik ih dodaje kroz "Dodaj projektanta";
  "Vodeći Projektant" nalozi se ne nude — nadzorna uloga).
- **Vlaka** (`vlake`): autor = `korisnik_id`, pripadnost projektu =
  `projekt_id`. Jedinstvenost imena: `(korisnik_id, projekt_id, nm)` —
  DB spriječava da JEDAN korisnik ima dvije T5 u istom projektu, ali NE
  može spriječiti da dva RAZLIČITA projektanta imaju istu T5 (RLS
  dozvoljava upis samo vlastitih redova, pa cross-user constraint nije
  izvediv). Rješava se obavijestima u aplikaciji (vidi §3).
- **Doznaka** (`doz_projects` + `doz_project_members` +
  `doz_area_markings` + `doz_track_points`): kreator + aktivni članovi
  (`je_doz_clan`).

## 2. Prava (RLS — migracija 20260611_vlasnistvo_rls.sql)

| Radnja | Ko smije |
|---|---|
| Vidjeti projekat | vlasnik, članovi, ŠPD (read-only), admin |
| Mijenjati/brisati projekat | samo vlasnik (brisanje kaskadno briše SVE vlake projekta, i članske — upozorenje u dijalogu) |
| Dodati/ukloniti člana | vlasnik; član može ukloniti sam sebe ("🚪 Napusti projekat", v3.27.8) |
| Vidjeti vlake projekta | svi članovi + vlasnik (+ ŠPD/admin) |
| Mijenjati/brisati vlaku | isključivo autor te vlake |
| Doznaka plohe/tačke | vide i dodaju samo članovi odjela; briše autor ili kreator odjela |

Napomena: kad član napusti projekat, njegove vlake OSTAJU u projektu
(vidljive ostatku tima); on ih i dalje vidi kao svoje.

## 3. Sinkronizacija i sudari imena — vlake

**Radi (potvrđeno u kodu):**
- Realtime kanal po šumariji (`_onVlakaRtEvent`): promjene kolega na
  aktivnom projektu se odmah iscrtavaju (fast-path bez punog reload-a),
  uz toast "X dodao/la vlaku". Događaji vlastitog naloga s drugog
  uređaja se također primjenjuju (fix v3.27.1).
- Povratak iz pozadine: provjera kanala + full-sync kolega (throttle 15s),
  jer Android suspenduje WebSocket.
- Vlake kolega se keširaju po projektu (`_kvcSave`) — vidljive i offline.
- Upozorenje na duplikat imena kod kolege pri GPS snimanju (`addV` →
  `_kolegaVlakaDup` dijalog).

**Popravljeno u v3.28.6:**
1. **STD / rekap STD kartica / CSV / TXT izvoz** su računali SAMO vlake
   prijavljenog projektanta — tim od 2+ projektanata je dobijao
   podcijenjen STD i pogrešnu ukupnu dužinu za odjel. Novi
   `_projSveVlake()` spaja moje + kolegine vlake aktivnog projekta i
   koristi se u sva 4 mjesta (`updProjStats`, `exportTerenStats`,
   `exportSTDcsv`, `exportSTDtxt`).
2. Upozorenje na duplikat kod kolege dodano i u **ručno crtanje**
   (`startManualVlakaDraw`) i **preimenovanje** (`edpRename`) — ranije
   je postojalo samo pri GPS snimanju.
3. **Predloženi broj nove vlake** (`_nextMainBr`) sad preskače i brojeve
   koje su kolege zauzele na projektu — ranije bi aplikacija predložila
   T5 iako kolega već ima T5, pa bi korisnik odmah udario u dijalog.

**Ostaje kao poznato ograničenje:**
- Dva projektanta i dalje MOGU svjesno kreirati istoimenu vlaku
  (potvrda kroz dijalog) — DB to ne može zabraniti zbog RLS-a.
- Numeracija se oslanja na učitane kolege vlake; ako su oba uređaja
  offline u šumi, oba mogu predložiti isti broj — sudar se vidi tek po
  sinkronizaciji (obavijest, bez gubitka podataka: vlake su odvojeni
  redovi po autoru).
- `odjeli` tabela (autocomplete naziva) upsert-uje po
  `(sumarija, naziv)` pa drugi korisnik koji spremi isti naziv preuzme
  `korisnik_id` reda — bezopasno (samo autocomplete), zabilježeno u
  kodu (index.html, komentar kod sbSaveOdjel).

## 4. Doznaka — stanje

- Kanal po otvorenom odjelu (`_dozSubProject`/`_dozEnsureChannel`) +
  catchup pri povratku iz pozadine (`_dozSchedCatchup`).
- Članovi: kreator dodaje kroz "Doznaka → članovi" (`dozAddMember`);
  RLS dozvoljava i samo-dodavanje kreatora pri kreiranju odjela.
- Plohe (markinzi) su odvojeni redovi po autoru — nema konflikta upisa;
  brisanje je soft (`is_visible=false`), pa retry/echo ne pravi duhove.
- Auto-link doznaka odjela s projektom vlaka po nazivu
  (`_dozAutoLinkVlake`) — prikaz vlaka preko doznaka podloge.
- Dijeljenje doznake ŠIFROM (share_codes, kind='doznaka'): server je
  spreman (migracija 20260710), UI dugme u Doznaka tabu još NIJE
  dodano — na čekanju potvrde da projektni tok radi.

## 5. Preporuke (nije rađeno, po prioritetu)

1. U STD listi označiti autora uz vlake kolega (mala inicijala/boja) —
   sad se vide zbirno, bez atribucije.
2. "Ko je online" indikator po projektu (postoji `_kolegeActiveSince`
   za live bar — može se proširiti na listu članova).
3. Masovna ispravka postojećih naziva bez "T" prefiksa (v3.28.5
   normalizuje samo nove unose).

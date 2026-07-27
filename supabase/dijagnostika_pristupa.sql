-- ============================================================
-- DIJAGNOSTIKA PRISTUPA — pokreni PRIJE migracije 20260727_pristup_odobrenje.sql
--
-- Ovo NIJE migracija — ništa ne mijenja, samo čita stanje. Živa šema ovog
-- projekta nije opisana repoom (nema nijednog CREATE TABLE za korisnici/
-- projekti/vlake/doz_*; migracija 20260611_vlasnistvo_rls.sql:236-238 doslovno
-- kaže "Pretpostavljamo da korisnici tabela već ima RLS"), pa se bez ovog
-- ispisa pooštravanje radi naslijepo.
--
-- Pokreni u Supabase SQL Editoru, po jedan blok, i pošalji rezultate.
-- ============================================================

-- ─── 0a. Koje tabele uopšte imaju uključen RLS? ─────────────
-- Tabela sa relrowsecurity = false NEMA nikakvu zaštitu na nivou reda —
-- politike na njoj (ako postoje) se ne primjenjuju.
select c.relname as tabela, c.relrowsecurity as rls_ukljucen
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- ─── 0b. Sve politike — NAJVAŽNIJE ──────────────────────────
-- Traži red za tablename='korisnici' sa cmd='UPDATE'. Ako je `qual` širi od
-- `id = auth.uid()` (npr. true, ili poređenje po šumariji), to je AKTIVNA
-- rupa: RLS ne zna ograničiti kolonu, pa jedan PATCH na /rest/v1/korisnici
-- može postaviti is_admin=true i odobren=true samom sebi.
select tablename, policyname, permissive, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- ─── 0c. SECURITY DEFINER funkcije + ko ih smije zvati ──────
-- prosecdef = true znači da funkcija zaobilazi RLS (radi s pravima vlasnika).
-- U koloni `prava` traži `=X/` bez imena role ispred — to znači da funkciju
-- smije zvati BILO KO (PUBLIC), uključujući neprijavljene (anon).
select p.proname as funkcija,
       p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as vlasnik,
       coalesce(array_to_string(p.proacl, ' | '), '(default: PUBLIC)') as prava
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by 1;

-- ─── 0d. Admin nalozi ───────────────────────────────────────
-- Provjeri postoji li još bootstrap nalog iz 20260331_admin_kml_styles.sql
-- (ime "Unsko sanske šume", sumarija 'USŠ d.o.o.') — njegov PIN je 2501 i
-- stoji u javnom repou, pa ga treba promijeniti ili obrisati.
select id, ime, prezime, sumarija, is_admin, odobren, created_at
from korisnici
where is_admin = true
order by created_at;

-- ─── 0e. Ko će biti automatski odobren migracijom ───────────
-- Migracija (po dogovoru) postavlja odobren=true SVIMA postojećima da niko
-- na terenu ne ostane zaključan. Pogledaj listu prije nego je pokreneš —
-- ako neko ovdje ne pripada firmi, obriši ga prije migracije.
select id, ime, prezime, sumarija, odobren, created_at
from korisnici
order by created_at desc;

-- ─── 0f. Postoje li nalozi izvan poznatih šumarija? ─────────
-- Migracija pravi tabelu dozvoljenih šumarija i puni je i ovim vrijednostima
-- (da nikog ne zaključa), ali je dobro vidjeti ima li smeća.
select sumarija, count(*) as broj
from korisnici
group by sumarija
order by broj desc;

-- ─── 0g. Nalozi koji se po IMENU računaju kao vodeći ────────
-- Ovi će migracijom dobiti je_vodeci = true (backfill). Provjeri da su svi
-- legitimni — do sada je bilo dovoljno registrovati se pod tim imenom da se
-- dobije uvid u sve projekte šumarije.
select id, ime, prezime, sumarija, odobren, created_at
from korisnici
where lower(trim(ime)) in ('vodeći projektant', 'vodeci projektant')
order by sumarija;

-- ─── 0h. Postoji li admin_delete_user i kako je zaštićen? ───
-- Klijent ga zove (index.html:5861) ali ga nema ni u jednoj migraciji —
-- kreiran je ručno, pa mu je autorizacija neprovjerljiva iz repoa.
select p.proname, p.prosecdef,
       coalesce(array_to_string(p.proacl, ' | '), '(default: PUBLIC)') as prava,
       pg_get_functiondef(p.oid) as definicija
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'admin_delete_user';

-- ============================================================
-- PRISTUP FIRME — dovršetak (nastavak na 20260727_pristup_odobrenje.sql)
--
-- UZROK: dijagnostika žive baze (supabase/dijagnostika_pristupa.sql) pokazala
-- je dvije rupe koje se iz repoa nisu mogle vidjeti, jer su nastale RUČNIM
-- radom u Supabase dashboardu i nikad nisu bile pod verzijom:
--
--   A) Na `korisnici` su ostale DVIJE permissive SELECT politike sa `qual =
--      true` ("anon_read" i "korisnici select"). Permissive politike se ILI-uju,
--      pa su te dvije potpuno poništavale pooštreni korisnici_select_kolege:
--      bilo ko (i neprijavljen) je čitao CIJELU tabelu korisnika — imena,
--      login_email, sumarija, is_admin, odobren. login_email je sintetički i
--      nigdje drugo vidljiv, a s njim i PIN-om ide direktno signInWithPassword,
--      pa je to bio kompletan materijal za napad na prijavu.
--
--   B) Sedam tabela s podacima nije dobilo `zzz_odobren` u prošloj migraciji —
--      namjerno, jer im se iz repoa nisu vidjele politike pa bi uključivanje
--      restrikcije naslijepo moglo sve zaključati. Sad se vide, sve su smislene
--      (vlasništvo preko korisnik_id/user_id), pa se restrikcija može dodati.
--
-- Idempotentna. Pokreće se RUČNO u Supabase SQL Editoru.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. Provjera zauzetosti imena BEZ otvaranja imenika
-- ════════════════════════════════════════════════════════════
-- doRegister() provjerava je li ime već zauzeto PRIJE sb.auth.signUp(), dakle
-- kao ANON — i upravo zbog toga je "anon_read" politika i postojala. Zato se
-- prvo mora dati uska zamjena, pa tek onda ukloniti široko čitanje (redoslijed
-- u ovoj migraciji je namjeran).
--
-- Funkcija vraća SAMO boolean — nikakve podatke. Ostaje "oracle" za pitanje
-- "postoji li X Y?", ali to je neizbježno kod registracije po imenu i
-- neuporedivo uže od dosadašnjeg čitanja cijele tabele.
create or replace function public.ime_zauzeto(p_ime text, p_prezime text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.korisnici
    where lower(trim(ime))     = lower(trim(coalesce(p_ime, '')))
      and lower(trim(prezime)) = lower(trim(coalesce(p_prezime, '')))
  );
$$;

revoke all on function public.ime_zauzeto(text, text) from public;
grant execute on function public.ime_zauzeto(text, text) to anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- 2. Uklanjanje zaostalih širokih/dupliranih politika na `korisnici`
-- ════════════════════════════════════════════════════════════
-- Ostaju samo: korisnici_select_kolege (vlastiti red + kolege iste šumarije +
-- ŠPD/admin nadzor), korisnici_nadzor_select, korisnici_insert_self,
-- korisnici_update_self — plus trigger korisnici_zastita iz 20260727 koji čuva
-- povlaštene kolone (RLS ne zna ograničiti kolonu).

-- Široke — GLAVNA RUPA:
drop policy if exists "anon_read"           on public.korisnici;
drop policy if exists "korisnici select"    on public.korisnici;

-- Suvišna: je_spd() je već jedan od uslova u korisnici_select_kolege.
drop policy if exists "korisnici_spd_select" on public.korisnici;

-- Duplikati (svi su id = auth.uid(), isto što rade *_self politike):
drop policy if exists "korisnici insert"    on public.korisnici;
drop policy if exists "own_insert"          on public.korisnici;
drop policy if exists "korisnici update"    on public.korisnici;


-- ════════════════════════════════════════════════════════════
-- 3. `zzz_odobren` na preostale tabele s podacima
-- ════════════════════════════════════════════════════════════
-- Isti obrazac kao u 20260727: RESTRICTIVE politika se I-uje s postojećim
-- permissive politikama, pa se nijedna postojeća ne prepisuje.
--
-- kml_styles_global se NAMJERNO izostavlja — čita se pri startu radi stilova
-- karte, ne sadrži ni lične ni projektne podatke, pa bi restrikcija samo
-- pokvarila prikaz bez sigurnosne koristi.
do $$
declare t text;
begin
  foreach t in array array[
    'tragovi', 'text_labels', 'dnevni_log', 'odjeli',
    'loc_fotos', 'ref_karte', 'share_codes'
  ] loop
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = t) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists "zzz_odobren" on public.%I', t);
      execute format($f$create policy "zzz_odobren" on public.%I
        as restrictive for all to authenticated
        using (public.je_odobren()) with check (public.je_odobren())$f$, t);
    end if;
  end loop;
end $$;


-- ════════════════════════════════════════════════════════════
-- 4. Osvježi PostgREST schema keš
-- ════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

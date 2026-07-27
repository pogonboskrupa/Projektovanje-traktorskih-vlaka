-- ============================================================
-- PRISTUP FIRME — odobrenje korisnika da stvarno vrijedi NA SERVERU
--
-- UZROK: kolona korisnici.odobren postoji od 20260701, ali je gate bio
-- ISKLJUČIVO u JavaScriptu (index.html, showApp()). Korisnik dobije važeći
-- Supabase JWT već pri sb.auth.signUp() — dakle PRIJE nego gate uopšte odradi
-- — pa dok sjedi na ekranu "Čeka se odobrenje" može zvati PostgREST i RPC-ove
-- direktno, mimo aplikacije. Riječ `odobren` se do sada nije pojavljivala ni u
-- jednoj RLS politici ni u jednoj pomoćnoj funkciji: biti *prijavljen* je
-- svuda bilo dovoljno.
--
-- Ova migracija to zatvara na serveru i usput uklanja nekoliko posljedičnih
-- rupa (samopromocija kroz korisnici, samododijeljena šumarija, uloga vodećeg
-- po IMENU, create_projektant dostupan svima, samoupis u tuđi doznaka odjel).
--
-- PRIJE POKRETANJA pokreni supabase/dijagnostika_pristupa.sql i pogledaj
-- rezultat — posebno postoji li već široka UPDATE politika na `korisnici`.
--
-- Idempotentna je (može se pokrenuti više puta). Pokreće se RUČNO u Supabase
-- SQL Editoru — ovaj projekat nema migration runner.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. POMOĆNA FUNKCIJA — jedini izvor istine o pristupu
-- ════════════════════════════════════════════════════════════
-- Admin je NAMJERNO implicitno odobren: bez toga bi admin koji sam sebi
-- slučajno opozove odobrenje ostao zaključan bez načina da se vrati.
-- Korisnik bez reda u `korisnici` → false (zatvoreno u sigurnom smjeru).
create or replace function public.je_odobren()
returns boolean language sql security definer stable
set search_path = public, auth as $$
  select coalesce((
    select coalesce(k.odobren, false) or coalesce(k.is_admin, false)
    from public.korisnici k where k.id = auth.uid()
  ), false);
$$;

revoke all on function public.je_odobren() from public;
grant execute on function public.je_odobren() to authenticated;


-- ════════════════════════════════════════════════════════════
-- 2. GRANDFATHERING — prije nego politike stupe na snagu
-- ════════════════════════════════════════════════════════════
-- Niko ko već koristi aplikaciju ne smije ostati zaključan (isti obrazac kao
-- 20260701_odobrenje_i_reset.sql:14). Nove registracije i dalje defaultuju na
-- FALSE i čekaju admina.
update public.korisnici set odobren = true where odobren is distinct from true;


-- ════════════════════════════════════════════════════════════
-- 3. DOZVOLJENE ŠUMARIJE — lista na serveru, ne samo u HTML-u
-- ════════════════════════════════════════════════════════════
-- `sumarija` je bila slobodan TEXT bez ikakvog ograničenja, a je_spd() je
-- doslovno `sumarija = 'ŠPD US ŠUME'` i daje čitanje SVIH projekata i vlaka.
-- Padajući meni u registraciji je samo HTML — direktan REST upis je mogao
-- postaviti bilo šta. Dakle: samododijeljena privilegija.
create table if not exists public.sumarije (
  naziv   text primary key,
  aktivna boolean not null default true
);

insert into public.sumarije(naziv) values
  ('ŠPD US ŠUME'),
  ('ŠUMARIJA BOS.KRUPA'),
  ('ŠUMARIJA BOS.PETROVAC'),
  ('ŠUMARIJA SANSKI MOST'),
  ('ŠUMARIJA BIHAĆ'),
  ('ŠUMARIJA CAZIN'),
  ('ŠUMARIJA KLJUČ')
on conflict do nothing;

-- Postojeće netipične vrijednosti (npr. bootstrap admin 'USŠ d.o.o.') se NE
-- smiju izgubiti — inače bi im svaki naredni update reda pao na provjeri.
insert into public.sumarije(naziv)
  select distinct sumarija from public.korisnici where sumarija is not null
on conflict do nothing;

alter table public.sumarije enable row level security;
drop policy if exists "sumarije_select" on public.sumarije;
create policy "sumarije_select" on public.sumarije
  for select to authenticated using (true);
-- Upis samo kroz SQL Editor / admina — nema INSERT/UPDATE/DELETE politike.


-- ════════════════════════════════════════════════════════════
-- 4. VODEĆI PROJEKTANT — prava kolona umjesto regexa nad IMENOM
-- ════════════════════════════════════════════════════════════
-- Do sada je uloga bila `lower(trim(ime)) in ('vodeći projektant', ...)`, i to
-- su poštovale TRI SECURITY DEFINER funkcije. Ko god se registruje pod tim
-- imenom dobijao je pregled svih projekata i doznaka cijele šumarije.
alter table public.korisnici
  add column if not exists je_vodeci boolean not null default false;

-- Backfill po dosadašnjem pravilu — nijedan sadašnji vodeći se ne gubi.
update public.korisnici set je_vodeci = true
where lower(trim(ime)) in ('vodeći projektant', 'vodeci projektant')
  and je_vodeci is distinct from true;

create or replace function public.je_vodeci()
returns boolean language sql security definer stable
set search_path = public, auth as $$
  select coalesce((
    select k.je_vodeci from public.korisnici k where k.id = auth.uid()
  ), false);
$$;

revoke all on function public.je_vodeci() from public;
grant execute on function public.je_vodeci() to authenticated;

create or replace function public.admin_set_vodeci(p_user_id uuid, p_vodeci boolean)
returns void language plpgsql security definer
set search_path = public, auth as $$
begin
  if not public.je_admin() then
    raise exception 'Pristup odbijen — samo admin';
  end if;
  update korisnici set je_vodeci = coalesce(p_vodeci, false) where id = p_user_id;
end $$;

revoke all on function public.admin_set_vodeci(uuid, boolean) from public;
grant execute on function public.admin_set_vodeci(uuid, boolean) to authenticated;


-- ════════════════════════════════════════════════════════════
-- 5. ZAKLJUČAVANJE TABELE `korisnici`
-- ════════════════════════════════════════════════════════════
-- Nijedna dosadašnja migracija nije uključila RLS na `korisnici` niti
-- definisala INSERT/UPDATE politiku — postojale su samo dvije SELECT politike.
-- Klijent je i upisivao svoj red (registracija) i UPDATE-ovao TUĐE redove
-- (backfill boje kolega), pa je politika morala biti široka. Kako RLS ne zna
-- ograničiti pojedinu KOLONU, povlaštene kolone štiti trigger ispod.

create or replace function public.korisnici_zastita()
returns trigger language plpgsql security definer
set search_path = public, auth as $$
declare v_admin boolean;
begin
  -- Bez JWT-a = service_role (edge funkcije handle-registration-action,
  -- backup skripte) ili SECURITY DEFINER kontekst bez sesije — pusti.
  -- Anon ionako ne prolazi RLS politike ispod, pa ovo nije rupa.
  if auth.uid() is null then return new; end if;

  select coalesce(k.is_admin, false) into v_admin
    from korisnici k where k.id = auth.uid();
  if coalesce(v_admin, false) then return new; end if;

  if tg_op = 'INSERT' then
    new.id        := auth.uid();  -- ne smije napraviti tuđi profil
    new.odobren   := false;       -- ne smije se sam odobriti
    new.is_admin  := false;       -- ne smije se sam promovisati u admina
    new.je_vodeci := false;       -- ni sam sebe proglasiti vodećim
    if not exists (select 1 from sumarije s
                   where s.naziv = new.sumarija and s.aktivna) then
      raise exception 'Nepoznata šumarija: %', new.sumarija;
    end if;
    return new;
  end if;

  -- UPDATE: povlaštene kolone ostaju kakve su bile. Namjerno TIHO (bez
  -- exception-a) — klijent legitimno šalje samo `boja`, a greška bi mu
  -- srušila normalan tok; pokušaj promjene se jednostavno ne primi.
  new.id          := old.id;
  new.odobren     := old.odobren;
  new.is_admin    := old.is_admin;
  new.je_vodeci   := old.je_vodeci;
  new.sumarija    := old.sumarija;
  new.login_email := old.login_email;
  return new;
end $$;

drop trigger if exists trg_korisnici_zastita on public.korisnici;
create trigger trg_korisnici_zastita
  before insert or update on public.korisnici
  for each row execute function public.korisnici_zastita();

alter table public.korisnici enable row level security;

-- Postojeće SELECT politike (korisnici_select_kolege, korisnici_nadzor_select)
-- se NE diraju — čitanje kolega iste šumarije mora ostati kako jeste.
drop policy if exists "korisnici_insert_self" on public.korisnici;
create policy "korisnici_insert_self" on public.korisnici
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "korisnici_update_self" on public.korisnici;
create policy "korisnici_update_self" on public.korisnici
  for update to authenticated
  using      (id = auth.uid() or public.je_admin())
  with check (id = auth.uid() or public.je_admin());


-- ════════════════════════════════════════════════════════════
-- 6. RESTRICTIVE POLITIKA ODOBRENJA na svim tabelama s podacima
-- ════════════════════════════════════════════════════════════
-- PostgreSQL RESTRICTIVE politike se logički I-uju s postojećim permissive
-- politikama (koje se međusobno ILI-uju). Zato NE prepisujemo nijednu
-- postojeću politiku iz 20260611/20260713 — dodajemo jedan uslov iznad svih.
-- Restrictive politika sama ne DAJE pristup, samo ga oduzima; sve ove tabele
-- već imaju permissive politike, pa nema opasnosti od "sve zabranjeno".
--
-- NAPOMENA: tabele tragovi, text_labels, dnevni_log, odjeli, loc_fotos,
-- ref_karte se ovdje NAMJERNO ne diraju — nijedna migracija im ne definiše
-- politike, pa dok se iz dijagnostike ne vidi imaju li ih uopšte, uključivanje
-- RLS-a na njima bi ih potpuno zaključalo. Idu u zasebnu migraciju.
do $$
declare t text;
begin
  foreach t in array array[
    'projekti', 'projekt_clanovi', 'vlake',
    'doz_projects', 'doz_project_members', 'doz_area_markings', 'doz_track_points'
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
-- 7. SITNE ZAKRPE POSTOJEĆIH POLITIKA
-- ════════════════════════════════════════════════════════════

-- projekti_update / vlake_update su imale USING bez WITH CHECK — vlasnik je
-- mogao prepisati korisnik_id i pokloniti (ili osirotiti) svoj red.
drop policy if exists "projekti_update" on public.projekti;
create policy "projekti_update" on public.projekti
  for update
  using      (korisnik_id = auth.uid())
  with check (korisnik_id = auth.uid());

drop policy if exists "vlake_update" on public.vlake;
create policy "vlake_update" on public.vlake
  for update
  using      (korisnik_id = auth.uid())
  with check (korisnik_id = auth.uid());

-- doz_members_insert je imala `or user_id = auth.uid()` (namjera: "kreator
-- dodaje samog sebe"), ali je to značilo da BILO KO upiše sebe u BILO KOJI
-- odjel čiji UUID zna — i time otključa je_doz_clan() nad markinzima i GPS
-- tačkama. Kreator je i dalje pokriven prvim uslovom (created_by = auth.uid()).
drop policy if exists "doz_members_insert" on public.doz_project_members;
create policy "doz_members_insert" on public.doz_project_members
  for insert
  with check (exists (select 1 from public.doz_projects
                      where id = project_id and created_by = auth.uid()));


-- ════════════════════════════════════════════════════════════
-- 8. UKIDANJE create_projektant
-- ════════════════════════════════════════════════════════════
-- Bila je SECURITY DEFINER, GRANT ... TO authenticated, a jedina provjera je
-- bila `auth.uid() IS NOT NULL` — dakle BILO KOJI prijavljen korisnik (i
-- neodobren!) je mogao upisivati redove direktno u auth.users. Svi novi nalozi
-- sad idu isključivo kroz registraciju + admin odobrenje.
drop function if exists public.create_projektant(text, text, text);


-- ════════════════════════════════════════════════════════════
-- 9. ZAKRPE SECURITY DEFINER FUNKCIJA — provjera odobrenja
-- ════════════════════════════════════════════════════════════
-- SECURITY DEFINER funkcije zaobilaze RLS, pa restrictive politika iz koraka 6
-- na njih NE djeluje — svaka mora sama provjeriti odobrenje.

-- ─── 9a. Otkup šifre za dijeljenje ──────────────────────────
-- Vraća pun snapshot projekta sa svom GPS geometrijom. Jedina provjera je bila
-- `auth.uid() IS NOT NULL` → neodobren nalog je mogao otkupljivati šifre.
create or replace function redeem_share_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_code TEXT;
  v_rec  RECORD;
  v_out  JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Prijava obavezna';
  END IF;
  IF NOT public.je_odobren() THEN
    RAISE EXCEPTION 'Pristup odbijen — nalog nije odobren';
  END IF;
  v_code := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));

  SELECT * INTO v_rec FROM share_codes WHERE code = v_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Šifra ne postoji — provjeri s projektantom';
  END IF;

  IF v_rec.kind = 'projekat' THEN
    SELECT jsonb_build_object(
      'kind', 'projekat',
      'code', v_code,
      'projekat', jsonb_build_object(
        'odjel', p.odjel, 'gj', p.gj, 'povrsina', p.povrsina, 'datum', p.datum,
        'vlasnik', COALESCE(NULLIF(TRIM(COALESCE(k.ime,'') || ' ' || COALESCE(k.prezime,'')), ''), '—')
      ),
      'vlake', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'nm', v.nm, 'br', v.br, 'kr', v.kr, 'strana', v.strana,
          'boja', v.boja, 'lager', v.lager, 'pts', v.pts
        ) ORDER BY v.br, v.kr)
        FROM vlake v WHERE v.projekt_id = p.id
      ), '[]'::jsonb)
    ) INTO v_out
    FROM projekti p
    LEFT JOIN korisnici k ON k.id = p.korisnik_id
    WHERE p.id = v_rec.target_id;

    IF v_out IS NULL THEN
      RAISE EXCEPTION 'Projekat više ne postoji';
    END IF;
    RETURN v_out;
  END IF;

  SELECT jsonb_build_object(
    'kind', 'doznaka',
    'code', v_code,
    'projekat', jsonb_build_object('odjel', dp.name, 'gj', NULL, 'povrsina', dp.known_area_ha, 'datum', NULL,
      'vlasnik', COALESCE(NULLIF(TRIM(COALESCE(k.ime,'') || ' ' || COALESCE(k.prezime,'')), ''), '—')),
    'markings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'type', m.marking_type, 'label', m.label, 'note', m.note,
        'geojson', m.boundary_geojson, 'area_ha', m.area_ha
      ))
      FROM doz_area_markings m WHERE m.project_id = dp.id AND m.is_visible
    ), '[]'::jsonb)
  ) INTO v_out
  FROM doz_projects dp
  LEFT JOIN korisnici k ON k.id = dp.created_by
  WHERE dp.id = v_rec.target_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'Doznaka odjel više ne postoji';
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION redeem_share_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_share_code(TEXT) TO authenticated;

-- ─── 9b. Kreiranje šifre ────────────────────────────────────
create or replace function create_share_code(
  p_kind      TEXT,
  p_target_id UUID,
  p_code      TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_code  TEXT;
  v_owner UUID;
BEGIN
  IF NOT public.je_odobren() THEN
    RAISE EXCEPTION 'Pristup odbijen — nalog nije odobren';
  END IF;

  v_code := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  IF length(v_code) < 4 OR length(v_code) > 16 THEN
    RAISE EXCEPTION 'Šifra mora imati 4–16 slova/cifara';
  END IF;

  IF p_kind = 'projekat' THEN
    SELECT korisnik_id INTO v_owner FROM projekti WHERE id = p_target_id;
  ELSIF p_kind = 'doznaka' THEN
    SELECT created_by INTO v_owner FROM doz_projects WHERE id = p_target_id;
  ELSE
    RAISE EXCEPTION 'Nepoznat tip dijeljenja';
  END IF;

  IF v_owner IS NULL OR v_owner != auth.uid() THEN
    RAISE EXCEPTION 'Samo vlasnik može podijeliti šifrom';
  END IF;

  IF EXISTS (SELECT 1 FROM share_codes s WHERE s.code = v_code AND s.created_by != auth.uid()) THEN
    RAISE EXCEPTION 'Šifra je zauzeta — izaberi drugu';
  END IF;

  DELETE FROM share_codes s WHERE s.kind = p_kind AND s.target_id = p_target_id AND s.created_by = auth.uid();
  INSERT INTO share_codes (code, kind, target_id, created_by)
    VALUES (v_code, p_kind, p_target_id, auth.uid())
    ON CONFLICT (code) DO UPDATE SET kind = excluded.kind, target_id = excluded.target_id, created_at = now();

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION create_share_code(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_share_code(TEXT, UUID, TEXT) TO authenticated;

-- ─── 9c. Pregled projekata šumarije (vodeći) ────────────────
-- Provjera po IMENU zamijenjena kolonom je_vodeci + provjerom odobrenja.
DROP FUNCTION IF EXISTS vodeci_projekti_pregled();
CREATE OR REPLACE FUNCTION vodeci_projekti_pregled()
RETURNS TABLE(
  id              UUID,
  sumarija        TEXT,
  gj              TEXT,
  odjel           TEXT,
  datum           TEXT,
  povrsina        DOUBLE PRECISION,
  vlasnik         TEXT,
  korisnik_id     UUID,
  maticnih        BIGINT,
  krakova         BIGINT,
  ukupno_m        DOUBLE PRECISION,
  zadnja_izmjena  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sum   TEXT;
  v_ok    BOOLEAN;
BEGIN
  IF NOT public.je_odobren() THEN
    RAISE EXCEPTION 'Pristup odbijen — nalog nije odobren';
  END IF;

  SELECT k.sumarija, (COALESCE(k.is_admin, FALSE) OR COALESCE(k.je_vodeci, FALSE))
    INTO v_sum, v_ok
    FROM korisnici k WHERE k.id = auth.uid();

  IF NOT COALESCE(v_ok, FALSE) THEN
    RAISE EXCEPTION 'Pristup odbijen — samo vodeći projektant ili admin';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.sumarija, p.gj, p.odjel, p.datum::TEXT,
    p.povrsina::DOUBLE PRECISION,
    COALESCE(NULLIF(TRIM(COALESCE(k.ime, '') || ' ' || COALESCE(k.prezime, '')), ''), '—') AS vlasnik,
    p.korisnik_id,
    COUNT(v.id) FILTER (WHERE v.kr = 0)          AS maticnih,
    COUNT(v.id) FILTER (WHERE v.kr > 0)          AS krakova,
    COALESCE(SUM(vlaka_len_m(v.pts)), 0)         AS ukupno_m,
    MAX(v.updated_at)                            AS zadnja_izmjena
  FROM projekti p
  LEFT JOIN korisnici k ON k.id = p.korisnik_id
  LEFT JOIN vlake v     ON v.projekt_id = p.id
  WHERE p.sumarija = v_sum
  GROUP BY p.id, p.sumarija, p.gj, p.odjel, p.datum, p.povrsina, k.ime, k.prezime, p.korisnik_id
  ORDER BY p.gj, p.datum DESC;
END;
$$;

REVOKE ALL ON FUNCTION vodeci_projekti_pregled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vodeci_projekti_pregled() TO authenticated;

-- ─── 9d. Pregled doznake šumarije (vodeći) ──────────────────
DROP FUNCTION IF EXISTS vodeci_doznaka_pregled();
CREATE OR REPLACE FUNCTION vodeci_doznaka_pregled()
RETURNS TABLE(
  id             UUID,
  name           TEXT,
  status         TEXT,
  known_area_ha  DOUBLE PRECISION,
  zona_n         BIGINT,
  zona_ha        DOUBLE PRECISION,
  tacaka         BIGINT,
  clanova        BIGINT,
  kreirao        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sum   TEXT;
  v_ok    BOOLEAN;
BEGIN
  IF NOT public.je_odobren() THEN
    RAISE EXCEPTION 'Pristup odbijen — nalog nije odobren';
  END IF;

  SELECT k.sumarija, (COALESCE(k.is_admin, FALSE) OR COALESCE(k.je_vodeci, FALSE))
    INTO v_sum, v_ok
    FROM korisnici k WHERE k.id = auth.uid();

  IF NOT COALESCE(v_ok, FALSE) THEN
    RAISE EXCEPTION 'Pristup odbijen — samo vodeći projektant ili admin';
  END IF;

  RETURN QUERY
  SELECT
    dp.id, dp.name, dp.status,
    dp.known_area_ha::DOUBLE PRECISION,
    (SELECT COUNT(*) FROM doz_area_markings m
      WHERE m.project_id = dp.id AND m.is_visible)                       AS zona_n,
    COALESCE((SELECT SUM(m.area_ha) FROM doz_area_markings m
      WHERE m.project_id = dp.id AND m.is_visible), 0)::DOUBLE PRECISION AS zona_ha,
    (SELECT COUNT(*) FROM doz_track_points t
      WHERE t.project_id = dp.id)                                        AS tacaka,
    (SELECT COUNT(*) FROM doz_project_members pm
      WHERE pm.project_id = dp.id AND COALESCE(pm.is_active, TRUE))      AS clanova,
    COALESCE(NULLIF(TRIM(COALESCE(k.ime, '') || ' ' || COALESCE(k.prezime, '')), ''), '—') AS kreirao
  FROM doz_projects dp
  LEFT JOIN korisnici k ON k.id = dp.created_by
  WHERE k.sumarija = v_sum
  ORDER BY dp.name;
END;
$$;

REVOKE ALL ON FUNCTION vodeci_doznaka_pregled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vodeci_doznaka_pregled() TO authenticated;


-- ─── 9e. Izvještaj aktivnosti (admin + vodeći) ──────────────
DROP FUNCTION IF EXISTS izvjestaj_aktivnost(DATE, DATE);
CREATE OR REPLACE FUNCTION izvjestaj_aktivnost(p_od DATE, p_do DATE)
RETURNS TABLE(
  datum        DATE,
  vrsta        TEXT,             -- 'vlaka' | 'doznaka'
  ime_prezime  TEXT,
  sumarija     TEXT,
  odjel        TEXT,
  vrijednost   DOUBLE PRECISION  -- metri (vlaka) ili ha (doznaka)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sum    TEXT;
  v_admin  BOOLEAN;
  v_vodeci BOOLEAN;
BEGIN
  IF NOT public.je_odobren() THEN
    RAISE EXCEPTION 'Pristup odbijen — nalog nije odobren';
  END IF;

  SELECT k.sumarija, COALESCE(k.is_admin, FALSE), COALESCE(k.je_vodeci, FALSE)
    INTO v_sum, v_admin, v_vodeci
    FROM korisnici k WHERE k.id = auth.uid();

  IF NOT COALESCE(v_admin OR v_vodeci, FALSE) THEN
    RAISE EXCEPTION 'Pristup odbijen — samo vodeći projektant ili admin';
  END IF;

  RETURN QUERY
  SELECT dl.datum::DATE, 'vlaka'::TEXT,
         COALESCE(
           NULLIF(TRIM(dl.projektant), ''),
           NULLIF(TRIM(COALESCE(k.ime, '') || ' ' || COALESCE(k.prezime, '')), ''),
           '—'
         ),
         k.sumarija, dl.odjel, dl.meters::DOUBLE PRECISION
  FROM dnevni_log dl
  LEFT JOIN korisnici k ON k.id = dl.korisnik_id
  WHERE dl.datum::DATE BETWEEN p_od AND p_do
    AND COALESCE(dl.meters, 0) > 0
    AND (v_admin OR k.sumarija = v_sum)

  UNION ALL

  SELECT dam.created_at::DATE, 'doznaka'::TEXT,
         COALESCE(NULLIF(TRIM(COALESCE(k2.ime, '') || ' ' || COALESCE(k2.prezime, '')), ''), '—'),
         k2.sumarija, COALESCE(dp.name, '—'), dam.area_ha::DOUBLE PRECISION
  FROM doz_area_markings dam
  LEFT JOIN korisnici k2 ON k2.id = dam.created_by
  LEFT JOIN doz_projects dp ON dp.id = dam.project_id
  WHERE dam.created_at::DATE BETWEEN p_od AND p_do
    AND COALESCE(dam.is_visible, TRUE)
    AND COALESCE(dam.area_ha, 0) > 0
    AND (v_admin OR k2.sumarija = v_sum)

  ORDER BY 1, 2, 3;
END;
$$;

REVOKE ALL ON FUNCTION izvjestaj_aktivnost(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION izvjestaj_aktivnost(DATE, DATE) TO authenticated;


-- ════════════════════════════════════════════════════════════
-- 10. admin_get_all_users — dodaj je_vodeci u ispis
-- ════════════════════════════════════════════════════════════
-- Potpis (RETURNS TABLE) se mijenja → DROP prije CREATE.
DROP FUNCTION IF EXISTS admin_get_all_users();
CREATE OR REPLACE FUNCTION admin_get_all_users()
RETURNS TABLE(
  id                UUID,
  ime               TEXT,
  prezime           TEXT,
  sumarija          TEXT,
  login_email       TEXT,
  boja              TEXT,
  is_admin          BOOLEAN,
  odobren           BOOLEAN,
  je_vodeci         BOOLEAN,
  created_at        TIMESTAMPTZ,
  last_sign_in_at   TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    k.id, k.ime, k.prezime, k.sumarija,
    k.login_email, k.boja, k.is_admin, k.odobren, k.je_vodeci, k.created_at,
    u.last_sign_in_at
  FROM korisnici k
  LEFT JOIN auth.users u ON u.id = k.id
  WHERE EXISTS (
    SELECT 1 FROM korisnici a
    WHERE a.id = auth.uid() AND a.is_admin = TRUE
  )
  ORDER BY k.odobren ASC, k.sumarija, k.ime   -- neodobreni (FALSE) prvi
$$;

REVOKE ALL ON FUNCTION admin_get_all_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_all_users() TO authenticated;


-- ════════════════════════════════════════════════════════════
-- 11. Osvježi PostgREST schema keš
-- ════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

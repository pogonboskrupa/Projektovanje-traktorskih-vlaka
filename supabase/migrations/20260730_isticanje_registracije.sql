-- ============================================================
-- ISTICANJE NEODOBRENE REGISTRACIJE — 7 dana
--
-- UZROK: registracija koju admin nikad ne pregleda ostaje zauvijek u stanju
-- "čeka odobrenje" — nalog trajno postoji u auth.users i korisnici, a ime mu
-- ostaje trajno zauzeto (ime_zauzeto() ga i dalje vidi), pa se ta osoba ne
-- može ni ponovo registrovati pod istim imenom ako je npr. pogriješila unos.
--
-- Novo pravilo: ako admin ne odobri nalog u roku od 7 dana OD REGISTRACIJE,
-- nalog (i korisnici red i auth.users red) se TRAJNO BRIŠE — korisnik mora
-- popuniti registraciju iznova. Nema pg_cron/scheduled infrastrukture (ovaj
-- projekat je namjerno bez CI-ja) — čišćenje se okida na dva prirodna mjesta
-- koja se ionako već dešavaju:
--   1) svaki put kad ADMIN otvori tab Korisnici (admin_get_all_users) — čisti
--      SVE istekle registracije u sistemu, ne samo jednu.
--   2) svaki put kad SAM KORISNIK na ekranu "Čeka se odobrenje" klikne
--      "Provjeri ponovo" (check_own_pending_expiry) — čisti ODMAH njegov
--      vlastiti nalog ako je istekao, bez čekanja da neki admin prvi otvori
--      panel.
--
-- KLJUČNA RAZLIKA koju pravilo mora poštovati: "čeka odobrenje" (nikad
-- pregledan) NIJE isto što i "opozvan" (admin je ranije odobrio, pa kasnije
-- povukao pristup) — opozvan nalog ima isti odobren=FALSE, ali NE SMIJE biti
-- obrisan poslije 7 dana (to bi bilo brisanje stvarnog, ranije aktivnog
-- korisnika samo zato što je dugo na "pauzi"). Zato nova kolona
-- prvo_odobren_at pamti KAD je nalog PRVI PUT odobren i nikad se poslije ne
-- briše/mijenja — brisanje po isteku gleda ISKLJUČIVO naloge kojima je ta
-- kolona i dalje NULL.
--
-- Idempotentna. Pokreće se RUČNO u Supabase SQL Editoru.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. Kolona koja pamti PRVO odobrenje (razlikuje "čeka" od "opozvan")
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.korisnici
  ADD COLUMN IF NOT EXISTS prvo_odobren_at TIMESTAMPTZ;

-- Grandfathering: svi koji su VEĆ odobreni (bilo kad, uključujući stare
-- naloge odobrene prije ove migracije) dobijaju prvo_odobren_at = created_at
-- — inače bi ih sljedeći DODATNI opoziv+7dana greškom učinio "nikad odobren"
-- kandidatom za brisanje.
UPDATE public.korisnici
  SET prvo_odobren_at = created_at
  WHERE odobren = TRUE AND prvo_odobren_at IS NULL;


-- ════════════════════════════════════════════════════════════
-- 2. admin_set_approved — upiši prvo_odobren_at pri PRVOM odobrenju
-- ════════════════════════════════════════════════════════════
-- Isti potpis kao 20260701_odobrenje_i_reset.sql — CREATE OR REPLACE, ne
-- treba DROP. COALESCE čuva postojeću vrijednost: naredni opoziv/ponovno
-- odobrenje NIKAD ne pomjera ovaj datum unaprijed.
CREATE OR REPLACE FUNCTION admin_set_approved(
  p_user_id  UUID,
  p_odobren  BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_admin BOOLEAN;
BEGIN
  SELECT k.is_admin INTO v_caller_admin
    FROM korisnici k WHERE k.id = auth.uid();

  IF NOT COALESCE(v_caller_admin, FALSE) THEN
    RAISE EXCEPTION 'Pristup odbijen — samo admin';
  END IF;

  UPDATE korisnici SET
    odobren = COALESCE(p_odobren, FALSE),
    prvo_odobren_at = CASE
      WHEN p_odobren IS TRUE THEN COALESCE(prvo_odobren_at, now())
      ELSE prvo_odobren_at
    END
  WHERE korisnici.id = p_user_id;
END;
$$;


-- ════════════════════════════════════════════════════════════
-- 3. Bulk brisanje svih isteklih (interno — nema GRANT-a authenticated-u)
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.internal_expire_stale_registrations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  SELECT array_agg(id) INTO v_ids
    FROM public.korisnici
    WHERE odobren = FALSE
      AND prvo_odobren_at IS NULL             -- nikad odobren (ne opozvan)
      AND COALESCE(is_admin, FALSE) = FALSE   -- admin se ne dira
      AND created_at < now() - INTERVAL '7 days';

  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  -- korisnici prvo (dijete), pa auth.users (roditelj) — sigurno bez obzira
  -- na to je li FK cascade konfigurisan (schema nije u repou, pa se ne zna).
  DELETE FROM public.korisnici WHERE id = ANY(v_ids);
  DELETE FROM auth.users WHERE id = ANY(v_ids);

  RETURN array_length(v_ids, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.internal_expire_stale_registrations() FROM PUBLIC;


-- ════════════════════════════════════════════════════════════
-- 4. Samoprovjera — poziva je SAM korisnik sa "Čeka se odobrenje" ekrana
-- ════════════════════════════════════════════════════════════
-- Briše ISKLJUČIVO poziočev VLASTITI red ako je istekao (auth.uid() = id),
-- ne bilo čiji. Vraća TRUE ako je (upravo) obrisan, FALSE ako nije istekao.
CREATE OR REPLACE FUNCTION public.check_own_pending_expiry()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_expired BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT (
    odobren = FALSE
    AND prvo_odobren_at IS NULL
    AND COALESCE(is_admin, FALSE) = FALSE
    AND created_at < now() - INTERVAL '7 days'
  ) INTO v_expired
  FROM public.korisnici WHERE id = auth.uid();

  IF COALESCE(v_expired, FALSE) THEN
    DELETE FROM public.korisnici WHERE id = auth.uid();
    DELETE FROM auth.users WHERE id = auth.uid();
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.check_own_pending_expiry() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_own_pending_expiry() TO authenticated;


-- ════════════════════════════════════════════════════════════
-- 5. admin_get_all_users — okini bulk čišćenje + prikaži rok isteka
-- ════════════════════════════════════════════════════════════
-- LANGUAGE sql → plpgsql (treba PERFORM prije SELECT-a). Potpis se mijenja
-- (nova kolona istice_at) → DROP prije CREATE.
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
  last_sign_in_at   TIMESTAMPTZ,
  istice_at         TIMESTAMPTZ   -- NULL osim za naloge koji čekaju PRVO odobrenje
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM korisnici a WHERE a.id = auth.uid() AND a.is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Pristup odbijen — samo admin';
  END IF;

  PERFORM public.internal_expire_stale_registrations();

  RETURN QUERY
  SELECT
    k.id, k.ime, k.prezime, k.sumarija,
    k.login_email, k.boja, k.is_admin, k.odobren, k.je_vodeci, k.created_at,
    u.last_sign_in_at,
    CASE
      WHEN k.odobren = FALSE AND k.prvo_odobren_at IS NULL AND COALESCE(k.is_admin, FALSE) = FALSE
      THEN k.created_at + INTERVAL '7 days'
    END AS istice_at
  FROM korisnici k
  LEFT JOIN auth.users u ON u.id = k.id
  ORDER BY k.odobren ASC, k.sumarija, k.ime;   -- neodobreni (FALSE) prvi
END;
$$;

REVOKE ALL ON FUNCTION admin_get_all_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_all_users() TO authenticated;


-- ════════════════════════════════════════════════════════════
-- 6. Osvježi PostgREST schema keš
-- ════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

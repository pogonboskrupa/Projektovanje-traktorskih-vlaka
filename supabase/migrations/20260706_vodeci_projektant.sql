-- ============================================================
-- VODEĆI PROJEKTANT — nadzorni nalog po šumariji
--
-- Nalog se registruje kroz NORMALNU registraciju u aplikaciji:
--   ime      = "Vodeći Projektant"
--   prezime  = naziv šumarije (npr. "Bihać")
--   šumarija = ta ista šumarija
-- pa se prikazuje kao "Vodeći Projektant Bihać". Admin ga odobrava i
-- po potrebi mu resetuje PIN kroz postojeći Admin panel (admin_reset_pin).
--
-- Aplikacija ulogu prepoznaje po imenu (isVodeci()). Ove dvije funkcije
-- su SECURITY DEFINER da vodeći dobije pregled SVIH projekata/doznaka
-- SVOJE šumarije bez obzira na RLS (koji običnom korisniku daje samo
-- vlastite + dijeljene). Pristup: samo vodeći (po imenu) ili admin.
--
-- Primijeniti u Supabase SQL Editoru (kao ranije 202607* migracije).
-- ============================================================

-- ─── A. Pregled svih projekata šumarije vodećeg ──────────────
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
  SELECT k.sumarija,
         (k.is_admin OR lower(trim(k.ime)) IN ('vodeći projektant', 'vodeci projektant'))
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

-- ─── B. Pregled doznake šumarije vodećeg ─────────────────────
-- Doznaka odjeli (doz_projects) nemaju kolonu šumarije — scope ide preko
-- šumarije KREATORA odjela (korisnici.sumarija).
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
  SELECT k.sumarija,
         (k.is_admin OR lower(trim(k.ime)) IN ('vodeći projektant', 'vodeci projektant'))
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

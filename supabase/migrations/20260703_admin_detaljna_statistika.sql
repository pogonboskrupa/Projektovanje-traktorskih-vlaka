-- ============================================================
-- Admin v2: vrijeme prijave + detaljna statistika + pregled projekata
-- SAMOSTALNA migracija — pokriva i 20260702 (idempotentno), pa je
-- dovoljno primijeniti SAMO OVU (svejedno da li je 20260702 već bila).
--   A) admin_get_all_users + last_sign_in_at
--   B) vlaka_len_m(pts) — dužina vlake iz JSONB tačaka (haversina)
--   C) admin_stats() v2 — aktivni/7d, matične+krakovi, zadnja aktivnost
--   D) admin_projekti_pregled() — svi projekti svih šumarija sa statistikom
-- ============================================================

-- ─── A. admin_get_all_users s last_sign_in_at ────────────────
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
  created_at        TIMESTAMPTZ,
  last_sign_in_at   TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    k.id, k.ime, k.prezime, k.sumarija,
    k.login_email, k.boja, k.is_admin, k.odobren, k.created_at,
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

-- ─── B. Dužina vlake iz JSONB tačaka ─────────────────────────
-- pts format: [{"la": 44.9, "lo": 16.1, "al": 200}, ...]
-- Haversina između uzastopnih tačaka — ista formula kao klijentski dst().
CREATE OR REPLACE FUNCTION vlaka_len_m(p_pts JSONB)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total  DOUBLE PRECISION := 0;
  v_prev_la DOUBLE PRECISION := NULL;
  v_prev_lo DOUBLE PRECISION := NULL;
  v_la     DOUBLE PRECISION;
  v_lo     DOUBLE PRECISION;
  v_pt     JSONB;
  v_a      DOUBLE PRECISION;
BEGIN
  IF p_pts IS NULL OR jsonb_typeof(p_pts) <> 'array' THEN
    RETURN 0;
  END IF;
  FOR v_pt IN SELECT * FROM jsonb_array_elements(p_pts) LOOP
    v_la := (v_pt->>'la')::DOUBLE PRECISION;
    v_lo := (v_pt->>'lo')::DOUBLE PRECISION;
    IF v_la IS NULL OR v_lo IS NULL THEN CONTINUE; END IF;
    IF v_prev_la IS NOT NULL THEN
      v_a := sin(radians(v_la - v_prev_la) / 2) ^ 2
           + cos(radians(v_prev_la)) * cos(radians(v_la))
           * sin(radians(v_lo - v_prev_lo) / 2) ^ 2;
      v_total := v_total + 6371000 * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));
    END IF;
    v_prev_la := v_la;
    v_prev_lo := v_lo;
  END LOOP;
  RETURN v_total;
END;
$$;

-- ─── C. Detaljna statistika po šumariji (samo admin) ─────────
-- Potpis se mijenja u odnosu na 20260702 → DROP prije CREATE.
DROP FUNCTION IF EXISTS admin_stats();
CREATE OR REPLACE FUNCTION admin_stats()
RETURNS TABLE(
  sumarija          TEXT,
  korisnika         BIGINT,
  aktivnih_7d       BIGINT,
  projekata         BIGINT,
  maticnih          BIGINT,
  krakova           BIGINT,
  ukupno_m          DOUBLE PRECISION,
  zadnja_aktivnost  TIMESTAMPTZ
)
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

  RETURN QUERY
  WITH kor AS (
    SELECT k.sumarija AS s,
           COUNT(*) AS n,
           COUNT(*) FILTER (WHERE u.last_sign_in_at > now() - interval '7 days') AS n7,
           MAX(u.last_sign_in_at) AS zad
    FROM korisnici k
    LEFT JOIN auth.users u ON u.id = k.id
    GROUP BY k.sumarija
  ),
  vl AS (
    SELECT v.sumarija AS s,
           COUNT(*) FILTER (WHERE v.kr = 0) AS nm,
           COUNT(*) FILTER (WHERE v.kr > 0) AS nk,
           COALESCE(SUM(vlaka_len_m(v.pts)), 0) AS m
    FROM vlake v GROUP BY v.sumarija
  ),
  pr AS (
    SELECT p.sumarija AS s, COUNT(*) AS n
    FROM projekti p GROUP BY p.sumarija
  )
  SELECT
    COALESCE(kor.s, vl.s, pr.s)   AS sumarija,
    COALESCE(kor.n, 0)            AS korisnika,
    COALESCE(kor.n7, 0)           AS aktivnih_7d,
    COALESCE(pr.n, 0)             AS projekata,
    COALESCE(vl.nm, 0)            AS maticnih,
    COALESCE(vl.nk, 0)            AS krakova,
    COALESCE(vl.m, 0)             AS ukupno_m,
    kor.zad                       AS zadnja_aktivnost
  FROM kor
  FULL OUTER JOIN vl ON vl.s = kor.s
  FULL OUTER JOIN pr ON pr.s = COALESCE(kor.s, vl.s)
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION admin_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_stats() TO authenticated;

-- ─── D. Pregled svih projekata svih šumarija (samo admin) ────
DROP FUNCTION IF EXISTS admin_projekti_pregled();
CREATE OR REPLACE FUNCTION admin_projekti_pregled()
RETURNS TABLE(
  id              UUID,
  sumarija        TEXT,
  gj              TEXT,
  odjel           TEXT,
  datum           TEXT,
  povrsina        DOUBLE PRECISION,
  vlasnik         TEXT,
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
  v_caller_admin BOOLEAN;
BEGIN
  SELECT k.is_admin INTO v_caller_admin
    FROM korisnici k WHERE k.id = auth.uid();

  IF NOT COALESCE(v_caller_admin, FALSE) THEN
    RAISE EXCEPTION 'Pristup odbijen — samo admin';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.sumarija, p.gj, p.odjel, p.datum::TEXT,
    p.povrsina::DOUBLE PRECISION,
    COALESCE(NULLIF(TRIM(COALESCE(k.ime, '') || ' ' || COALESCE(k.prezime, '')), ''), '—') AS vlasnik,
    COUNT(v.id) FILTER (WHERE v.kr = 0)          AS maticnih,
    COUNT(v.id) FILTER (WHERE v.kr > 0)          AS krakova,
    COALESCE(SUM(vlaka_len_m(v.pts)), 0)         AS ukupno_m,
    MAX(v.updated_at)                            AS zadnja_izmjena
  FROM projekti p
  LEFT JOIN korisnici k ON k.id = p.korisnik_id
  LEFT JOIN vlake v     ON v.projekt_id = p.id
  GROUP BY p.id, p.sumarija, p.gj, p.odjel, p.datum, p.povrsina, k.ime, k.prezime
  ORDER BY p.sumarija, p.gj, p.datum DESC;
END;
$$;

REVOKE ALL ON FUNCTION admin_projekti_pregled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_projekti_pregled() TO authenticated;

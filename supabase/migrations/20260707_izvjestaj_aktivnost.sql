-- ============================================================
-- IZVJEŠTAJI — sedmični/mjesečni pregled aktivnosti (vlaka + doznaka)
--
-- Vraća PO DANU i PO OSOBI koliko je ko uradio:
--   - vlaka (metri)   iz dnevni_log ("Dnevnik radova" u Projekat tabu —
--     projektant klikom loguje dužinu vlaka za aktivni projekat tog dana)
--   - doznaka (ha)    iz doz_area_markings (svaka zona ima created_by/
--     created_at pa je atribucija po danu tačna bez ručnog logovanja)
--
-- Dostupno samo adminu (sve šumarije) i vodećem projektantu (samo svoja
-- šumarija) — isti obrazac provjere kao vodeci_projekti_pregled.
-- Podaci ostaju trajno u dnevni_log/doz_area_markings pa je "cijela
-- godina" dostupna prostim proširenjem p_od/p_do raspona.
-- ============================================================

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
  SELECT k.sumarija, COALESCE(k.is_admin, FALSE),
         lower(trim(k.ime)) IN ('vodeći projektant', 'vodeci projektant')
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

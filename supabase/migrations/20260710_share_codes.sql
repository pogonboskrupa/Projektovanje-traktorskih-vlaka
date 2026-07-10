-- ============================================================
-- ŠIFRE ZA DIJELJENJE PROJEKTA (teren)
-- Primijeniti u Supabase SQL Editoru.
-- ------------------------------------------------------------
-- Projektant napravi šifru za svoj projekat (npr. RK70ABGH) i saopšti
-- je terenskom radniku (ŠPD terenski profil — nema projekte ni pristup
-- tuđim vlakama kroz RLS). Terenski radnik ukuca šifru i dobije
-- READ-ONLY snapshot projekta + vlaka preko SECURITY DEFINER RPC-a —
-- bez ikakvog upisa u projekt_clanovi (terenski profil namjerno ostaje
-- van projektnog modela).
--
-- kind je proširiv ('projekat' sad; 'doznaka' predviđeno kasnije).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.share_codes (
  code       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'projekat' CHECK (kind IN ('projekat', 'doznaka')),
  target_id  UUID NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.share_codes ENABLE ROW LEVEL SECURITY;

-- Direktan pristup tabeli samo za vlasnika šifri (pregled/brisanje svojih).
-- Otkup šifre ide isključivo kroz redeem_share_code (SECURITY DEFINER) da
-- se šifre ne mogu enumerisati SELECT-om.
DROP POLICY IF EXISTS "share_codes_select" ON public.share_codes;
CREATE POLICY "share_codes_select" ON public.share_codes
  FOR SELECT USING (created_by = auth.uid());

DROP POLICY IF EXISTS "share_codes_delete" ON public.share_codes;
CREATE POLICY "share_codes_delete" ON public.share_codes
  FOR DELETE USING (created_by = auth.uid());

-- INSERT/UPDATE nema politike — ide samo kroz create_share_code RPC.

-- ─── Kreiranje/zamjena šifre (vlasnik projekta) ──────────────
CREATE OR REPLACE FUNCTION create_share_code(
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

  -- Šifru smije zauzeti samo jedan projekat; ako je već tuđa — javi jasno.
  IF EXISTS (SELECT 1 FROM share_codes s WHERE s.code = v_code AND s.created_by != auth.uid()) THEN
    RAISE EXCEPTION 'Šifra je zauzeta — izaberi drugu';
  END IF;

  -- Jedna šifra po cilju: zamijeni eventualnu staru šifru istog projekta.
  DELETE FROM share_codes s WHERE s.kind = p_kind AND s.target_id = p_target_id AND s.created_by = auth.uid();
  INSERT INTO share_codes (code, kind, target_id, created_by)
    VALUES (v_code, p_kind, p_target_id, auth.uid())
    ON CONFLICT (code) DO UPDATE SET kind = excluded.kind, target_id = excluded.target_id, created_at = now();

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION create_share_code(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_share_code(TEXT, UUID, TEXT) TO authenticated;

-- ─── Otkup šifre (bilo koji prijavljen korisnik) ─────────────
-- Vraća read-only snapshot: projekat + vlake (bez ID-jeva redova).
CREATE OR REPLACE FUNCTION redeem_share_code(p_code TEXT)
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

  -- kind = 'doznaka' — snapshot doznaka odjela (plohe/pojas markinzi)
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

NOTIFY pgrst, 'reload schema';

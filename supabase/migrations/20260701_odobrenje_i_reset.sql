-- ============================================================
-- Odobrenje korisnika (admin gate) + reset PIN-a
--   A) kolona `odobren` na korisnici + admin_set_approved + odobren u admin_get_all_users
--   B) admin_reset_pin (postavlja novu auth lozinku = PIN)
-- Primijeniti na Supabase (kao ranije 202606* migracije).
-- ============================================================

-- ─── A1. Kolona odobrenja ────────────────────────────────────
ALTER TABLE public.korisnici
  ADD COLUMN IF NOT EXISTS odobren BOOLEAN NOT NULL DEFAULT FALSE;

-- Odobri SVE POSTOJEĆE korisnike (niko ko već koristi app ne smije biti zaključan).
-- Nove registracije poslije ovoga defaultuju na FALSE i čekaju admina.
UPDATE public.korisnici SET odobren = TRUE WHERE odobren IS DISTINCT FROM TRUE;

-- ─── A2. Admin postavlja/opoziva odobrenje ───────────────────
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

  UPDATE korisnici SET odobren = COALESCE(p_odobren, FALSE)
    WHERE korisnici.id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION admin_set_approved(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_approved(UUID, BOOLEAN) TO authenticated;

-- ─── A3. admin_get_all_users s dodatnim `odobren` poljem ──────
-- Potpis (RETURNS TABLE) se mijenja → mora DROP prije CREATE.
DROP FUNCTION IF EXISTS admin_get_all_users();
CREATE OR REPLACE FUNCTION admin_get_all_users()
RETURNS TABLE(
  id           UUID,
  ime          TEXT,
  prezime      TEXT,
  sumarija     TEXT,
  login_email  TEXT,
  boja         TEXT,
  is_admin     BOOLEAN,
  odobren      BOOLEAN,
  created_at   TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    k.id, k.ime, k.prezime, k.sumarija,
    k.login_email, k.boja, k.is_admin, k.odobren, k.created_at
  FROM korisnici k
  WHERE EXISTS (
    SELECT 1 FROM korisnici a
    WHERE a.id = auth.uid() AND a.is_admin = TRUE
  )
  ORDER BY k.odobren ASC, k.sumarija, k.ime   -- neodobreni (FALSE) prvi
$$;

REVOKE ALL ON FUNCTION admin_get_all_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_all_users() TO authenticated;

-- ─── B. Admin resetuje PIN (nova auth lozinka) ───────────────
-- login_email je sintetički (nije prava adresa) pa standardni email-reset ne radi.
-- PIN = auth lozinka padovana na 6 cifara, isti obrazac kao create_projektant.
CREATE OR REPLACE FUNCTION admin_reset_pin(
  p_user_id  UUID,
  p_pin      TEXT
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

  IF p_pin !~ '^\d{4,6}$' THEN
    RAISE EXCEPTION 'PIN mora biti 4–6 cifara';
  END IF;

  UPDATE auth.users
    SET encrypted_password = crypt(rpad(p_pin, 6, '0'), gen_salt('bf')),
        updated_at = now()
    WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION admin_reset_pin(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_reset_pin(UUID, TEXT) TO authenticated;

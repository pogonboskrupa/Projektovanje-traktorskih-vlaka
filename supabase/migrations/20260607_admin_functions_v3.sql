-- ============================================================
-- Admin funkcije v3
-- Koristimo RETURNS SETOF korisnici umjesto RETURNS TABLE da
-- potpuno eliminišemo svaki problem s column name shadowingom.
-- DROP + CREATE da sigurno uklonimo stare verzije.
-- ============================================================

-- ─── 1. Dohvati SVE korisnike ────────────────────────────────
DROP FUNCTION IF EXISTS admin_get_all_users();

CREATE FUNCTION admin_get_all_users()
RETURNS SETOF korisnici
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT k.*
  FROM   korisnici k
  WHERE  (
    SELECT a.is_admin
    FROM   korisnici a
    WHERE  a.id = auth.uid()
    LIMIT  1
  ) = TRUE
  ORDER  BY k.sumarija, k.ime
$$;

REVOKE ALL  ON FUNCTION admin_get_all_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_all_users() TO authenticated;


-- ─── 2. Prebaci korisnika u drugu šumariju ───────────────────
DROP FUNCTION IF EXISTS admin_set_sumarija(UUID, TEXT);

CREATE FUNCTION admin_set_sumarija(p_user_id UUID, p_sumarija TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ok     BOOLEAN;
  v_target BOOLEAN;
BEGIN
  SELECT k.is_admin INTO v_ok     FROM korisnici k WHERE k.id = auth.uid()  LIMIT 1;
  SELECT k.is_admin INTO v_target FROM korisnici k WHERE k.id = p_user_id   LIMIT 1;

  IF NOT COALESCE(v_ok, FALSE) THEN
    RAISE EXCEPTION 'Pristup odbijen — samo admin';
  END IF;
  IF COALESCE(v_target, FALSE) THEN
    RAISE EXCEPTION 'Admin nalog se ne može premještati';
  END IF;

  UPDATE korisnici SET sumarija = p_sumarija WHERE korisnici.id = p_user_id;
END;
$$;

REVOKE ALL  ON FUNCTION admin_set_sumarija(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_sumarija(UUID, TEXT) TO authenticated;

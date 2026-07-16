-- ============================================================
-- TRAGOVI — client_uuid za pouzdan offline dedup
-- Primijeniti u Supabase SQL Editoru.
-- ------------------------------------------------------------
-- Bug: offline queue je za "upsert_trag" radio pre-lookup/link-back po
-- (korisnik_id, nm) — ali nm je auto-generisano ime tipa "Trag 12.07.2026."
-- (samo datum, bez vremena), pa dva traga snimljena isti dan imaju
-- IDENTIČNO ime. Kad se offline red čekanja obradi, drugi trag bi tiho
-- prepisao preko prvog (isti red u bazi), i lokalni sbId link-back je
-- imao i odvojen bug (t.nm umjesto t.name) pa se sbId nikad nije vratio
-- u lokalni zapis — naknadno editovanje/brisanje tog traga je ili pravilo
-- duplikat na serveru ili ga nikad stvarno nije brisalo.
--
-- client_uuid se generiše na klijentu (_genUUID) čim se trag snimi, i
-- pouzdano je jedinstven po tragu — koristi se kao dedup ključ umjesto nm.
-- ============================================================

ALTER TABLE public.tragovi ADD COLUMN IF NOT EXISTS client_uuid TEXT;

-- Djelimičan unique index (samo gdje client_uuid nije NULL) — stariji
-- redovi bez client_uuid (snimljeni prije ovog fixa) nisu pogođeni.
CREATE UNIQUE INDEX IF NOT EXISTS tragovi_client_uuid_uniq
  ON public.tragovi (korisnik_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VLAKE: nova kolona na_putu (krak "završava na putu")
-- Primijeniti u Supabase SQL Editoru PRIJE korištenja nove verzije app-a.
-- ------------------------------------------------------------
-- Krak koji izlazi na kamionski put na svom kraju mjeri se drugačije:
-- STD privlačenja = SAMO dužina tog kraka (drvo izlazi na put tu, ne vraća
-- se glavnom vlakom), i takav krak dobija vlastiti lager na kraju. Klijent
-- (index.html, sbFlushVlaka + _saveLocalVlake) od ove verzije UVIJEK šalje
-- polje na_putu u payloadu za svaki insert/update na vlake. Ako kolona ne
-- postoji, PostgREST vraća "PGRST204: Could not find the 'na_putu' column
-- of 'vlake' in the schema cache" i odbija SVAKI upis vlake (ne samo
-- označenih) — zato migraciju treba pokrenuti prije/na deployu.
-- ============================================================

ALTER TABLE public.vlake
  ADD COLUMN IF NOT EXISTS na_putu BOOLEAN NOT NULL DEFAULT FALSE;

-- Osvježi PostgREST schema cache odmah (inače zna kasniti do sljedećeg
-- automatskog reload-a).
NOTIFY pgrst, 'reload schema';

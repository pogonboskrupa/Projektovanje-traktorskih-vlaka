-- ============================================================
-- VLAKE: nedostajuća kolona projektant_ime
-- Primijeniti u Supabase SQL Editoru.
-- ------------------------------------------------------------
-- Klijent (index.html, sbFlushVlaka) šalje projektant_ime u payloadu
-- za svaki insert/update na vlake još od v3.2.4, ali kolona nikad
-- nije bila dodana pravom migracijom — vjerovatno je u nekom trenutku
-- postojala ručno dodana u SQL Editoru pa je nestala/nije prenesena,
-- ili nikad nije ni bila kreirana. PostgREST zato odbija SVAKI upis sa
-- "PGRST204: Could not find the 'projektant_ime' column of 'vlake'
-- in the schema cache" — 100% reprodukcija, bez obzira na mrežu.
-- ============================================================

ALTER TABLE public.vlake
  ADD COLUMN IF NOT EXISTS projektant_ime TEXT;

-- Osvježi PostgREST schema cache odmah (inače zna kasniti do sljedećeg
-- automatskog reload-a).
NOTIFY pgrst, 'reload schema';

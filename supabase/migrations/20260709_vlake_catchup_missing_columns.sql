-- ============================================================
-- VLAKE: sustigni kolone koje kod šalje ali baza (možda) nema
-- Primijeniti u Supabase SQL Editoru.
-- ------------------------------------------------------------
-- Ista klasa problema kao projektant_ime (vidi 20260709_vlake_-
-- projektant_ime.sql): PostgREST vraća SAMO JEDNU nedostajuću kolonu
-- po grešci ("PGRST204 ... could not find column X"), pa se ispravke
-- otkrivaju jedna po jedna umjesto sve odjednom. Ovo je sustizanje
-- svih preostalih kolona koje _sbFlushVlakaImpl/_saveLocalVlake
-- pišu na vlake, na jednom mjestu — IF NOT EXISTS čini ovo bezopasnim
-- i za kolone koje već postoje.
--
-- 'strana' je POTVRĐENO nedostajala (PGRST204, "strana" column) iako
-- je migracija za nju već postojala u 20260405_create_projektant.sql
-- — očito nikad nije bila stvarno pokrenuta u ovoj bazi. 'lager' i
-- 'lager_pt' su preventivni (vjerovatno već postoje iz originalnog
-- kreiranja tabele koje nije zabilježeno migracijom u ovom repou).
-- ============================================================

ALTER TABLE public.vlake
  ADD COLUMN IF NOT EXISTS strana TEXT DEFAULT NULL;

ALTER TABLE public.vlake
  ADD COLUMN IF NOT EXISTS lager TEXT DEFAULT NULL;

ALTER TABLE public.vlake
  ADD COLUMN IF NOT EXISTS lager_pt JSONB DEFAULT NULL;

NOTIFY pgrst, 'reload schema';

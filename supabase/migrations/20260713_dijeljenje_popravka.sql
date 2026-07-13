-- ============================================================
-- POPRAVKA DIJELJENJA PROJEKTA (vlake + doznaka) — KONSOLIDOVANO
-- Pokrenuti u Supabase SQL Editor. SIGURNO za višekratno pokretanje.
-- ------------------------------------------------------------
-- Simptom: kolega sa kojim je projekat podijeljen NE VIDI projekat
-- (ni vlake ni doznaku), bez obzira na verziju aplikacije.
--
-- Uzrok: dijeljenje se u potpunosti oslanja na RLS politike + pomoćne
-- SECURITY DEFINER funkcije na serveru. Ako su te politike/funkcije
-- nedostajuće, stare ili djelimično primijenjene (migracija 20260611
-- nije pokrenuta, ili ju je kasnija migracija poremetila), SELECT
-- podijeljenog projekta/vlaka/doznake vraća PRAZNO — pa kolega ne vidi
-- ništa iako je uredno dodan kao član.
--
-- Ova migracija PONOVO USPOSTAVLJA cjelokupnu autorizaciju dijeljenja
-- na čisto stanje (drop + recreate svih politika na projektnim tabelama),
-- pa dijeljenje radi za SVE korisnike, bez obzira koju verziju app-a
-- svako od njih ima (RLS je server-side, isti za sve verzije).
-- ============================================================

-- ─── 1. Pomoćne funkcije (SECURITY DEFINER — bez RLS rekurzije) ─────────────
create or replace function public.je_admin()
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.korisnici where id = auth.uid() and is_admin = true);
$$;

create or replace function public.je_spd()
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.korisnici where id = auth.uid() and sumarija = 'ŠPD US ŠUME');
$$;

create or replace function public.moja_sumarija()
returns text language sql security definer stable as $$
  select sumarija from public.korisnici where id = auth.uid();
$$;

create or replace function public.je_clan_projekta(pid uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.projekti where id = pid and korisnik_id = auth.uid())
      or exists (select 1 from public.projekt_clanovi where projekt_id = pid and korisnik_id = auth.uid());
$$;

create or replace function public.je_doz_clan(pid uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.doz_projects where id = pid and created_by = auth.uid())
      or exists (select 1 from public.doz_project_members where project_id = pid and user_id = auth.uid() and is_active = true);
$$;

-- ─── 2. Očisti postojeće politike na projektnim/doznaka tabelama ────────────
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array[
    'projekti', 'projekt_clanovi', 'vlake',
    'doz_projects', 'doz_project_members', 'doz_area_markings', 'doz_track_points'
  ] loop
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = t) then
      for pol in select policyname from pg_policies
                 where schemaname = 'public' and tablename = t loop
        execute format('drop policy if exists %I on public.%I', pol.policyname, t);
      end loop;
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

-- ─── 3. PROJEKTI ─────────────────────────────────────────────────────────────
create policy "projekti_select" on public.projekti for select using (
  korisnik_id = auth.uid() or public.je_clan_projekta(id) or public.je_spd() or public.je_admin());
create policy "projekti_insert" on public.projekti for insert with check (korisnik_id = auth.uid());
create policy "projekti_update" on public.projekti for update using (korisnik_id = auth.uid());
create policy "projekti_delete" on public.projekti for delete using (korisnik_id = auth.uid());

-- ─── 4. PROJEKT ČLANOVI ──────────────────────────────────────────────────────
create policy "projekt_clanovi_select" on public.projekt_clanovi for select using (
  korisnik_id = auth.uid() or public.je_clan_projekta(projekt_id) or public.je_spd() or public.je_admin());
create policy "projekt_clanovi_insert" on public.projekt_clanovi for insert with check (
  exists (select 1 from public.projekti where id = projekt_id and korisnik_id = auth.uid()));
create policy "projekt_clanovi_delete" on public.projekt_clanovi for delete using (
  exists (select 1 from public.projekti where id = projekt_id and korisnik_id = auth.uid())
  or korisnik_id = auth.uid());

-- ─── 5. VLAKE ────────────────────────────────────────────────────────────────
create policy "vlake_select" on public.vlake for select using (
  korisnik_id = auth.uid()
  or (projekt_id is not null and public.je_clan_projekta(projekt_id))
  or (projekt_id is not null and public.je_spd())
  or public.je_admin());
create policy "vlake_insert" on public.vlake for insert with check (korisnik_id = auth.uid());
create policy "vlake_update" on public.vlake for update using (korisnik_id = auth.uid());
create policy "vlake_delete" on public.vlake for delete using (korisnik_id = auth.uid());

-- ─── 6. DOZNAKA (odjeli / članovi / oznake / GPS tačke) ──────────────────────
create policy "doz_projects_select" on public.doz_projects for select using (
  created_by = auth.uid() or public.je_doz_clan(id));
create policy "doz_projects_insert" on public.doz_projects for insert with check (created_by = auth.uid());
create policy "doz_projects_update" on public.doz_projects for update using (created_by = auth.uid());
create policy "doz_projects_delete" on public.doz_projects for delete using (created_by = auth.uid());

create policy "doz_members_select" on public.doz_project_members for select using (
  user_id = auth.uid() or public.je_doz_clan(project_id));
create policy "doz_members_insert" on public.doz_project_members for insert with check (
  exists (select 1 from public.doz_projects where id = project_id and created_by = auth.uid())
  or user_id = auth.uid());
create policy "doz_members_update" on public.doz_project_members for update using (
  exists (select 1 from public.doz_projects where id = project_id and created_by = auth.uid()));
create policy "doz_members_delete" on public.doz_project_members for delete using (
  exists (select 1 from public.doz_projects where id = project_id and created_by = auth.uid())
  or user_id = auth.uid());

create policy "doz_markings_select" on public.doz_area_markings for select using (public.je_doz_clan(project_id));
create policy "doz_markings_insert" on public.doz_area_markings for insert with check (
  created_by = auth.uid() and public.je_doz_clan(project_id));
create policy "doz_markings_update" on public.doz_area_markings for update using (
  created_by = auth.uid()
  or exists (select 1 from public.doz_projects where id = project_id and created_by = auth.uid()));
create policy "doz_markings_delete" on public.doz_area_markings for delete using (
  created_by = auth.uid()
  or exists (select 1 from public.doz_projects where id = project_id and created_by = auth.uid()));

create policy "doz_tracks_select" on public.doz_track_points for select using (public.je_doz_clan(project_id));
create policy "doz_tracks_insert" on public.doz_track_points for insert with check (
  user_id = auth.uid() and public.je_doz_clan(project_id));
create policy "doz_tracks_delete" on public.doz_track_points for delete using (user_id = auth.uid());

-- ─── 7. KORISNICI — čitanje kolega iste šumarije (imena/boje + lista za dodavanje) ──
-- Bez ovoga vlasnik ne vidi kolege da ih doda, a imena/boje kolega na karti ne
-- rade. ADITIVNA politika (ne dira postojeće) — ako korisnici nema RLS, nema
-- efekta; ako ima, omogućava čitanje kolega iz iste šumarije + admin/ŠPD nadzor.
drop policy if exists "korisnici_select_kolege" on public.korisnici;
create policy "korisnici_select_kolege" on public.korisnici for select using (
  id = auth.uid()
  or sumarija = public.moja_sumarija()
  or public.je_spd()
  or public.je_admin());

-- ─── 8. Backfill: kreatori doznaka odjela postaju članovi ───────────────────
insert into public.doz_project_members (project_id, user_id, role, track_color, order_index, is_active)
select p.id, p.created_by, 'manager', '#3B8BD4', 0, true
from public.doz_projects p
where not exists (
  select 1 from public.doz_project_members m
  where m.project_id = p.id and m.user_id = p.created_by)
on conflict do nothing;

-- ─── 9. Osvježi PostgREST schema cache ──────────────────────────────────────
notify pgrst, 'reload schema';

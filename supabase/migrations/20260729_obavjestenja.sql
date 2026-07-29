-- ============================================================
-- OBAVJEŠTENJE ADMINA O NOVOJ REGISTRACIJI — Telegram + email direktno iz baze
--
-- UZROK PROMJENE: sistem iz 20260704_admin_notify_emails.sql nikad nije
-- proradio do kraja jer je SVE (i slanje maila i dugmad Odobri/Odbij) išlo kroz
-- Supabase Edge Funkcije. One traže `supabase functions deploy --no-verify-jwt`
-- plus Resend nalog plus tri secreta koja moraju biti RUČNO usklađena s
-- vrijednošću tvrdo kodiranom u SQL-u. Dovoljno je da jedan korak fali i ne
-- stigne ništa — bez ikakve poruke o grešci.
--
-- pg_net je običan HTTP klijent i može POST-ovati bilo gdje, pa i Telegram i
-- Resend idu SADA DIREKTNO IZ BAZE. Edge Funkcija ostaje potrebna samo za
-- dugmad Odobri/Odbij u poruci; ako ona nije deploy-ovana, obavještenja i dalje
-- stižu i odobrava se u aplikaciji (prije je izostalo sve).
--
-- SIGURNOST: stari NOTIFY_SECRET je bio tvrdo kodiran u 20260704:61, dakle u
-- JAVNOM repou, a isti string je HMAC ključ kojim se potpisuju linkovi za
-- odobravanje — svako s pristupom repou je mogao falsifikovati odobrenje bilo
-- kojeg korisnika. Tajne se sele u zaključanu tabelu app_secrets koja se puni
-- ručno i nikad ne ide u git. STARU TAJNU SMATRATI KOMPROMITOVANOM.
--
-- Idempotentna. Pokreće se RUČNO u Supabase SQL Editoru.
-- Poslije nje OBAVEZNO upisati tajne — vidi docs/OBAVJESTENJA.md.
-- ============================================================

create extension if not exists pg_net;
create extension if not exists pgcrypto;   -- hmac() za potpisivanje linkova

-- PAŽNJA za svaku buduću funkciju koja koristi pgcrypto (hmac/crypt/gen_salt):
-- u Supabase projektima pgcrypto po pravilu živi u šemi `extensions`, NE u
-- `public`. Funkcija sa `SET search_path = public, ...` tu šemu isključuje, pa
-- poziv padne sa "function hmac(...) does not exist". Zato SVE funkcije ispod
-- koje potpisuju linkove imaju `extensions` u search_path-u. Ovo je posebno
-- podmuklo ovdje jer je slanje umotano u EXCEPTION WHEN OTHERS THEN NULL (da
-- nikad ne sruši registraciju) — greška bi bila progutana, ništa ne bi stiglo,
-- a net._http_response bi ostao prazan, bez ijednog traga o uzroku.


-- ════════════════════════════════════════════════════════════
-- 1. Tajne izvan repoa
-- ════════════════════════════════════════════════════════════
create table if not exists public.app_secrets (
  kljuc      text primary key,
  vrijednost text not null,
  updated_at timestamptz not null default now()
);

-- NAMJERNO bez ijedne RLS politike: uz uključen RLS i nula politika tabela je
-- nedostupna i anon i authenticated korisnicima. Čitaju je samo SECURITY
-- DEFINER funkcije (izvršavaju se kao vlasnik) i service_role ključ.
alter table public.app_secrets enable row level security;

create or replace function public._tajna(p_kljuc text)
returns text language sql security definer stable
set search_path = public as $$
  select vrijednost from public.app_secrets where kljuc = p_kljuc;
$$;
revoke all on function public._tajna(text) from public;


-- ════════════════════════════════════════════════════════════
-- 2. Zajedničko slanje — koriste ga i trigger i probni RPC
-- ════════════════════════════════════════════════════════════
create or replace function public._posalji_obavjestenje(
  p_uid      uuid,
  p_ime      text,
  p_prezime  text,
  p_sumarija text,
  p_proba    boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_secret   text := public._tajna('notify_secret');
  v_tg_token text := public._tajna('telegram_token');
  v_tg_chat  text := public._tajna('telegram_chat_id');
  v_resend   text := public._tajna('resend_api_key');
  v_from     text := coalesce(public._tajna('resend_from'), 'onboarding@resend.dev');
  v_base     text := public._tajna('funkcije_url');
  v_exp      bigint;
  v_ok_url   text;
  v_no_url   text;
  v_ime      text := coalesce(p_ime, '') || ' ' || coalesce(p_prezime, '');
  v_naslov   text;
  v_mailovi  jsonb;
  v_html     text;
  v_tekst    text;
begin
  if v_secret is null then return; end if;   -- ništa nije podešeno, tiho izađi

  -- Linkovi vrijede 7 dana. Rok je DIO potpisane poruke, pa se ne može
  -- produžiti mijenjanjem URL-a — raniji linkovi nisu imali rok uopšte.
  v_exp := extract(epoch from now())::bigint + 7 * 24 * 3600;
  v_base := coalesce(v_base, 'https://djguplhaayjvwmdlxevx.supabase.co')
            || '/functions/v1/handle-registration-action';
  v_ok_url := v_base || '?uid=' || p_uid || '&action=approve&exp=' || v_exp
              || '&token=' || encode(hmac(p_uid::text || ':approve:' || v_exp, v_secret, 'sha256'), 'hex');
  v_no_url := v_base || '?uid=' || p_uid || '&action=reject&exp=' || v_exp
              || '&token=' || encode(hmac(p_uid::text || ':reject:' || v_exp, v_secret, 'sha256'), 'hex');

  v_naslov := case when p_proba then '🧪 PROBNO obavještenje — USS Vlake'
                   else '🌲 Nova registracija — čeka odobrenje' end;

  -- ── Telegram ────────────────────────────────────────────
  -- URL dugmad (ne callback_data) — ne treba webhook ni bot koji nešto sluša.
  if v_tg_token is not null and v_tg_chat is not null then
    begin
      v_tekst := '<b>' || v_naslov || '</b>' || E'\n\n'
              || '<b>' || trim(v_ime) || '</b>' || E'\n'
              || 'Šumarija: <b>' || coalesce(p_sumarija, '—') || '</b>'
              || case when p_proba
                      then E'\n\n<i>Ovo je proba — dugmad ispod ništa ne mijenjaju.</i>'
                      else E'\n\nČeka odobrenje za pristup aplikaciji.' end;
      perform net.http_post(
        url     := 'https://api.telegram.org/bot' || v_tg_token || '/sendMessage',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := jsonb_build_object(
          'chat_id', v_tg_chat,
          'text', v_tekst,
          'parse_mode', 'HTML',
          'reply_markup', jsonb_build_object(
            'inline_keyboard', jsonb_build_array(jsonb_build_array(
              jsonb_build_object('text', '✅ Odobri', 'url', v_ok_url),
              jsonb_build_object('text', '⛔ Odbij',  'url', v_no_url)
            ))
          )
        )
      );
    exception when others then null;   -- Telegram pao — email i registracija idu dalje
    end;
  end if;

  -- ── Email (Resend) ──────────────────────────────────────
  if v_resend is not null then
    begin
      select jsonb_agg(email) into v_mailovi from public.admin_notify_emails;
      if v_mailovi is not null then
        v_html := '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">'
               || '<h2 style="color:#166534;">' || v_naslov || '</h2>'
               || '<p><b>' || trim(v_ime) || '</b> — šumarija <b>'
               || coalesce(p_sumarija, '—') || '</b>'
               || case when p_proba then ' (probno obavještenje).'
                       else ' čeka odobrenje za pristup aplikaciji.' end || '</p>'
               || '<div style="margin:24px 0;">'
               || '<a href="' || v_ok_url || '" style="display:inline-block;padding:12px 22px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;margin-right:10px;">✓ Odobri</a>'
               || '<a href="' || v_no_url || '" style="display:inline-block;padding:12px 22px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">⛔ Odbij</a>'
               || '</div>'
               || '<p style="color:#64748b;font-size:12px;">Link vrijedi 7 dana. Odobriti se može i u aplikaciji, tab Korisnici.</p></div>';
        perform net.http_post(
          url     := 'https://api.resend.com/emails',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_resend
          ),
          body    := jsonb_build_object(
            'from', v_from,
            'to', v_mailovi,
            'subject', v_naslov || ': ' || trim(v_ime),
            'html', v_html
          )
        );
      end if;
    exception when others then null;
    end;
  end if;
end $$;

revoke all on function public._posalji_obavjestenje(uuid, text, text, text, boolean) from public;


-- ════════════════════════════════════════════════════════════
-- 3. Trigger na novu registraciju
-- ════════════════════════════════════════════════════════════
create or replace function public.notify_new_registration_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
begin
  -- Problem sa slanjem NIKAD ne smije srušiti registraciju.
  begin
    perform public._posalji_obavjestenje(NEW.id, NEW.ime, NEW.prezime, NEW.sumarija, false);
  exception when others then null;
  end;
  return NEW;
end $$;

drop trigger if exists trg_notify_new_registration on public.korisnici;
create trigger trg_notify_new_registration
  after insert on public.korisnici
  for each row
  when (NEW.odobren is not true)   -- ne šalji za već odobrene/grandfathered unose
  execute function public.notify_new_registration_trigger();


-- ════════════════════════════════════════════════════════════
-- 4. Probno obavještenje (dugme u Postavkama)
-- ════════════════════════════════════════════════════════════
-- Bez ovoga se podešavanje moglo provjeriti samo pravljenjem lažne registracije.
create or replace function public.admin_test_notifikacija()
returns text
language plpgsql
security definer
set search_path = public, net, extensions
as $$
begin
  if not public.je_admin() then
    raise exception 'Pristup odbijen — samo admin';
  end if;
  if public._tajna('notify_secret') is null then
    raise exception 'Tajne nisu podešene — vidi docs/OBAVJESTENJA.md';
  end if;
  perform public._posalji_obavjestenje(auth.uid(), 'PROBNO', 'Obavještenje', 'TEST', true);
  return 'Poslano. Provjeri Telegram/email; status poziva vidiš u net._http_response.';
end $$;

revoke all on function public.admin_test_notifikacija() from public;
grant execute on function public.admin_test_notifikacija() to authenticated;


-- ════════════════════════════════════════════════════════════
-- 5. Popravka istog propusta u admin_reset_pin
-- ════════════════════════════════════════════════════════════
-- admin_reset_pin iz 20260701_odobrenje_i_reset.sql koristi crypt()/gen_salt()
-- — također pgcrypto — uz `SET search_path = public, auth`, dakle BEZ šeme
-- `extensions`. Ako pgcrypto tamo živi (uobičajeno za Supabase), ta funkcija je
-- već sada pokvarena: admin ne može resetovati zaboravljen PIN, a greška se
-- vidi tek pri pokušaju. Tijelo je nepromijenjeno — dodan je samo `extensions`.
create or replace function admin_reset_pin(
  p_user_id  UUID,
  p_pin      TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
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


-- ════════════════════════════════════════════════════════════
-- 6. Osvježi PostgREST schema keš
-- ════════════════════════════════════════════════════════════
notify pgrst, 'reload schema';

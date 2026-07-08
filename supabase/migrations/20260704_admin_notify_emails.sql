-- ============================================================
-- Email obavještenje adminu o novoj registraciji + odobri/odbij direktno iz maila
--   A) admin_notify_emails — lista email adresa (uređuje se u app Postavke tabu)
--   B) pg_net + trigger — pri novoj registraciji async poziva Edge Function
--      koja šalje email sa linkovima "Odobri" / "Odbij"
-- Primijeniti na Supabase (kao ranije migracije).
--
-- NAPOMENA: ovo NIJE dovoljno samo za primjenu SQL-a — potrebno je i:
--   1. Deploy dvije Edge Function (supabase/functions/notify-new-registration
--      i supabase/functions/handle-registration-action) — vidi upute u chatu.
--   2. Postaviti Supabase secrets: RESEND_API_KEY i NOTIFY_SECRET.
--   3. NOTIFY_SECRET string ispod (X_NOTIFY_SECRET) MORA biti IDENTIČAN
--      vrijednosti koju postaviš kao Supabase secret NOTIFY_SECRET.
-- ============================================================

-- ─── A. Lista email adresa za obavještenja ───────────────────
CREATE TABLE IF NOT EXISTS public.admin_notify_emails (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  added_by   UUID REFERENCES public.korisnici(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_notify_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_notify_emails_select" ON public.admin_notify_emails;
DROP POLICY IF EXISTS "admin_notify_emails_insert" ON public.admin_notify_emails;
DROP POLICY IF EXISTS "admin_notify_emails_delete" ON public.admin_notify_emails;

CREATE POLICY "admin_notify_emails_select" ON public.admin_notify_emails
  FOR SELECT USING (public.je_admin());
CREATE POLICY "admin_notify_emails_insert" ON public.admin_notify_emails
  FOR INSERT WITH CHECK (public.je_admin());
CREATE POLICY "admin_notify_emails_delete" ON public.admin_notify_emails
  FOR DELETE USING (public.je_admin());

-- Podrazumijevani primalac (može se ukloniti/dodati kroz Postavke tab u appu)
INSERT INTO public.admin_notify_emails (email)
VALUES ('nedim.cehic@gmail.com')
ON CONFLICT (email) DO NOTHING;

-- ─── B. Async HTTP poziv Edge Function-u pri novoj registraciji ──────────────
CREATE EXTENSION IF NOT EXISTS pg_net;

-- VAŽNO: zamijeni oba mjesta ako regenerišeš tajnu — mora biti IDENTIČNA
-- Supabase secretu NOTIFY_SECRET (Dashboard → Edge Functions → Secrets).
-- Ovdje hardkodovano (ne u tabeli) — vidljivo samo vlasniku baze (tebi).
CREATE OR REPLACE FUNCTION public.notify_new_registration_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
BEGIN
  -- Nikad ne smije srušiti registraciju zbog problema sa slanjem obavještenja
  BEGIN
    PERFORM net.http_post(
      url     := 'https://djguplhaayjvwmdlxevx.supabase.co/functions/v1/notify-new-registration',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-notify-secret', '5ca322236b2edf900b2aab824325479270b1abfb053fb06f'
      ),
      body    := jsonb_build_object(
        'uid', NEW.id, 'ime', NEW.ime, 'prezime', NEW.prezime,
        'sumarija', NEW.sumarija, 'created_at', NEW.created_at
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- mrežni/pg_net problem — registracija ostaje uspješna, samo bez emaila
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_registration ON public.korisnici;
CREATE TRIGGER trg_notify_new_registration
  AFTER INSERT ON public.korisnici
  FOR EACH ROW
  WHEN (NEW.odobren IS NOT TRUE)   -- ne šalji za grandfathered/already-approved unose
  EXECUTE FUNCTION public.notify_new_registration_trigger();

// Supabase Edge Function: notify-new-registration
//
// Poziva je Postgres trigger (AFTER INSERT ON korisnici) preko pg_net —
// vidi supabase/migrations/20260704_admin_notify_emails.sql.
// Šalje email svim adresama iz admin_notify_emails tabele, sa dugmadima
// "Odobri" / "Odbij" koje vode na handle-registration-action Edge Function.
//
// DEPLOY: mora se deploy-ovati BEZ JWT provjere (--no-verify-jwt), jer poziv
// dolazi iz pg_net trigera bez Supabase Authorization headera — umjesto toga
// nosi vlastiti x-notify-secret header koji se provjerava ovdje.
//
// Potrebni Supabase secrets (Dashboard → Edge Functions → Secrets):
//   NOTIFY_SECRET      — ISTA vrijednost kao u SQL trigeru (x-notify-secret)
//   RESEND_API_KEY     — API key sa resend.com
//   NOTIFY_FROM_EMAIL  — opciono; default 'onboarding@resend.dev' (Resend sandbox
//                        pošiljalac, radi bez verifikacije domene)
// SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY su AUTOMATSKI dostupni svakoj
// Edge Function-u — ne treba ih ručno postavljati.

const NOTIFY_SECRET    = Deno.env.get('NOTIFY_SECRET') ?? '';
const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const FROM_EMAIL       = Deno.env.get('NOTIFY_FROM_EMAIL') ?? 'onboarding@resend.dev';

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!NOTIFY_SECRET || req.headers.get('x-notify-secret') !== NOTIFY_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: { uid?: string; ime?: string; prezime?: string; sumarija?: string };
  try { payload = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const { uid, ime, prezime, sumarija } = payload || {};
  if (!uid) return new Response('Missing uid', { status: 400 });

  // Lista primalaca iz admin_notify_emails (RLS zaobiđen service-role ključem)
  const listRes = await fetch(`${SUPABASE_URL}/rest/v1/admin_notify_emails?select=email`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` }
  });
  const rows: { email: string }[] = listRes.ok ? await listRes.json() : [];
  const emails = rows.map(r => r.email).filter(Boolean);
  if (!emails.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0, note: 'no recipients configured' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const approveToken = await hmacHex(NOTIFY_SECRET, `${uid}:approve`);
  const rejectToken  = await hmacHex(NOTIFY_SECRET, `${uid}:reject`);
  const base = `${SUPABASE_URL}/functions/v1/handle-registration-action`;
  const approveUrl = `${base}?uid=${encodeURIComponent(uid)}&action=approve&token=${approveToken}`;
  const rejectUrl  = `${base}?uid=${encodeURIComponent(uid)}&action=reject&token=${rejectToken}`;

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="color:#166534;">🌲 Nova registracija — USS Vlake</h2>
      <p><b>${escapeHtml(ime || '')} ${escapeHtml(prezime || '')}</b> se registrovao/la za šumariju
      <b>${escapeHtml(sumarija || '—')}</b> i čeka odobrenje za pristup aplikaciji.</p>
      <div style="margin:24px 0;">
        <a href="${approveUrl}" style="display:inline-block;padding:12px 22px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;margin-right:10px;">✓ Odobri</a>
        <a href="${rejectUrl}" style="display:inline-block;padding:12px 22px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">⛔ Odbij</a>
      </div>
      <p style="color:#64748b;font-size:12px;">Klikom na dugme se odluka odmah primjenjuje — nije potrebno otvarati aplikaciju.</p>
    </div>`;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: emails,
      subject: `Nova registracija — čeka odobrenje: ${ime || ''} ${prezime || ''}`.trim(),
      html
    })
  });

  const ok = resendRes.ok;
  const detail = ok ? null : await resendRes.text();
  return new Response(JSON.stringify({ ok, sent: ok ? emails.length : 0, error: detail }), {
    status: ok ? 200 : 502, headers: { 'Content-Type': 'application/json' }
  });
});

// Supabase Edge Function: handle-registration-action
//
// Javni GET endpoint na koji vode "Odobri"/"Odbij" dugmad iz email obavještenja
// (notify-new-registration). Nema Supabase sesiju/JWT (klik iz maila) — sigurnost
// je HMAC token u linku, izračunat istim NOTIFY_SECRET-om kao pri slanju emaila.
//
// DEPLOY: mora se deploy-ovati BEZ JWT provjere (--no-verify-jwt) — inače Supabase
// vraća 401 prije nego kod ovdje uopšte dobije priliku da provjeri token.
//
// Potrebni Supabase secrets (isti kao za notify-new-registration):
//   NOTIFY_SECRET — MORA biti identičan onome u SQL trigeru i drugoj funkciji.
// SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY su automatski dostupni.

const NOTIFY_SECRET    = Deno.env.get('NOTIFY_SECRET') ?? '';
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function page(title: string, body: string, color: string): Response {
  const icon = color === '#16a34a' ? '✅' : (color === '#dc2626' ? '⛔' : '⚠');
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title></head>
    <body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;">
      <div style="max-width:420px;text-align:center;background:#16213e;border:1px solid ${color};border-radius:14px;padding:28px 22px;">
        <div style="font-size:40px;margin-bottom:10px;">${icon}</div>
        <h2 style="margin:0 0 8px;color:${color};">${title}</h2>
        <p style="color:#94a3b8;font-size:14px;">${body}</p>
      </div>
    </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const uid    = url.searchParams.get('uid') || '';
  const action = url.searchParams.get('action') || '';
  const token  = url.searchParams.get('token') || '';

  if (!uid || !['approve', 'reject'].includes(action) || !token) {
    return page('Nevažeći link', 'Nedostaju parametri u linku.', '#f59e0b');
  }
  const expected = await hmacHex(NOTIFY_SECRET, `${uid}:${action}`);
  if (expected !== token) {
    return page('Nevažeći link', 'Token ne odgovara — link je možda oštećen.', '#f59e0b');
  }

  const odobren = action === 'approve';
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/korisnici?id=eq.${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation'
    },
    body: JSON.stringify({ odobren })
  });

  if (!patchRes.ok) {
    return page('Greška', 'Nije uspjelo ažuriranje korisnika. Pokušaj kroz aplikaciju (tab Korisnici).', '#f59e0b');
  }
  const rows = await patchRes.json();
  const u = rows?.[0];
  const name = u ? `${u.ime || ''} ${u.prezime || ''}`.trim() : 'Korisnik';

  return odobren
    ? page('Korisnik odobren', `${name} sada može koristiti aplikaciju.`, '#16a34a')
    : page('Korisnik odbijen', `${name} ostaje blokiran i ne može pristupiti aplikaciji.`, '#dc2626');
});

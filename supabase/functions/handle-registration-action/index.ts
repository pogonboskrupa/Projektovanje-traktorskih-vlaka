// Supabase Edge Function: handle-registration-action
//
// Javni GET endpoint na koji vode "Odobri"/"Odbij" dugmad iz Telegram poruke i
// email obavještenja (šalje ih SQL trigger — vidi
// supabase/migrations/20260729_obavjestenja.sql). Nema Supabase sesiju/JWT
// (klik iz poruke), pa je sigurnost HMAC token u linku.
//
// Ovo je JEDINA Edge Funkcija koja se mora deploy-ovati, i samo zbog dugmadi:
// sama obavještenja idu direktno iz baze preko pg_net. Ako ova funkcija nije
// deploy-ovana, obavještenja i dalje stižu — odobrava se u aplikaciji.
//
// DEPLOY: mora ići BEZ JWT provjere, inače Supabase vraća 401 prije nego kod
// ovdje uopšte dobije priliku provjeriti token:
//   supabase functions deploy handle-registration-action --no-verify-jwt
//
// Secrets NE TREBA ručno postavljati: NOTIFY_SECRET se čita iz tabele
// app_secrets (ključ 'notify_secret'). Ranije je stajao i u SQL-u i u Supabase
// secretima, pa je najčešći uzrok kvara bio da se ta dva raziđu.
// SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY su automatski dostupni.

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

// Poređenje otporno na mjerenje vremena — da se token ne može pogađati bajt po bajt.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readSecret(): Promise<string> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/app_secrets?kljuc=eq.notify_secret&select=vrijednost`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
  );
  if (!res.ok) return '';
  const rows: { vrijednost: string }[] = await res.json();
  return rows?.[0]?.vrijednost ?? '';
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
  const exp    = url.searchParams.get('exp') || '';

  if (!uid || !['approve', 'reject'].includes(action) || !token || !exp) {
    return page('Nevažeći link', 'Nedostaju parametri u linku.', '#f59e0b');
  }

  // Rok je DIO potpisane poruke, pa se ne može produžiti mijenjanjem URL-a.
  // Raniji linkovi nisu imali rok — vrijedili su zauvijek.
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum * 1000 < Date.now()) {
    return page('Link je istekao',
      'Ovo obavještenje je starije od 7 dana. Odobri korisnika u aplikaciji, tab Korisnici.', '#f59e0b');
  }

  const secret = await readSecret();
  if (!secret) {
    return page('Nije podešeno',
      'Tajna za potpisivanje nije postavljena u bazi (app_secrets). Vidi docs/OBAVJESTENJA.md.', '#f59e0b');
  }

  const expected = await hmacHex(secret, `${uid}:${action}:${exp}`);
  if (!safeEqual(expected, token)) {
    return page('Nevažeći link', 'Token ne odgovara — link je oštećen ili falsifikovan.', '#f59e0b');
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
  const sum  = u?.sumarija ? ` (${u.sumarija})` : '';

  return odobren
    ? page('Korisnik odobren', `${name}${sum} sada može koristiti aplikaciju.`, '#16a34a')
    : page('Korisnik odbijen', `${name}${sum} ostaje blokiran i ne može pristupiti aplikaciji.`, '#dc2626');
});

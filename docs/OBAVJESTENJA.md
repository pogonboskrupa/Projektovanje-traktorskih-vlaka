# Obavještenja o novoj registraciji — podešavanje

Kad se neko registruje, admin dobija obavještenje na **tri načina**:

| Kanal | Šta treba podesiti | Radi bez Edge Funkcije |
|---|---|---|
| Telegram poruka | bot token + chat id | ✅ da |
| Email | Resend API ključ + lista adresa | ✅ da |
| Oznaka u aplikaciji | ništa | ✅ da |
| Dugmad "Odobri/Odbij" u poruci | deploy jedne Edge Funkcije | ❌ traži deploy |

Obavještenja idu **direktno iz baze** (`pg_net`), pa stižu i ako Edge Funkcija
nikad ne bude deploy-ovana — tada se odobrava u aplikaciji (tab Korisnici).

Svaki kanal je nezavisan: ako podesiš samo Telegram, email se preskače i obrnuto.

---

## 1. Migracija

U Supabase SQL Editoru pokreni sadržaj fajla
`supabase/migrations/20260729_obavjestenja.sql`.

Time nastaje tabela `app_secrets` — zaključana je (RLS uključen, **nula
politika**), pa joj ne mogu pristupiti ni prijavljeni korisnici; čitaju je samo
serverske funkcije.

---

## 2. Telegram bot (~5 minuta)

1. U Telegramu otvori razgovor sa **@BotFather** → `/newbot` → daj mu ime.
   Dobiješ token oblika `8123456789:AAF...`.
2. **Pošalji svom botu bilo koju poruku** (npr. „zdravo") — bez toga bot ne
   smije prvi pisati tebi.
3. Otvori u pregledniku (zamijeni `<TOKEN>`):
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   U odgovoru nađi `"chat":{"id":123456789` — to je tvoj **chat id**.

Za grupu: dodaj bota u grupu, pošalji poruku u grupi, pa isti `getUpdates` —
chat id grupe je negativan broj (npr. `-1001234567890`).

---

## 3. Email (Resend) — opciono

1. Registruj se na [resend.com](https://resend.com) (besplatno: 100 mailova/dan).
2. **API Keys** → napravi ključ (`re_...`).
3. Pošiljalac: bez vlastite domene koristi `onboarding@resend.dev`. Ako imaš
   domenu firme, verifikuj je pa koristi npr. `obavjestenja@tvoja-domena.ba`.
4. Primaoce dodaješ u aplikaciji: **Postavke → Email obavještenja**.

> Napomena: Resend sandbox pošiljalac (`onboarding@resend.dev`) na nekim
> serverima završi u spamu. Ako mailovi ne stižu, prvo provjeri spam folder.

---

## 4. Upiši tajne

U SQL Editoru. **Ovo se nikad ne commita u git** — zato i postoji `app_secrets`.

Prvo generiši novu tajnu za potpisivanje linkova:
```sql
select encode(gen_random_bytes(32), 'hex');
```

Pa upiši (izostavi redove za kanal koji ne koristiš):
```sql
insert into public.app_secrets (kljuc, vrijednost) values
  ('notify_secret',    'REZULTAT_GORNJEG_UPITA'),
  ('telegram_token',   '8123456789:AAF...'),
  ('telegram_chat_id', '123456789'),
  ('resend_api_key',   're_...'),
  ('resend_from',      'onboarding@resend.dev')
on conflict (kljuc) do update
  set vrijednost = excluded.vrijednost, updated_at = now();
```

> ⚠ **Stara tajna `5ca322...` iz `20260704_admin_notify_emails.sql` je bila u
> javnom repou i mora se smatrati kompromitovanom.** Dok ne upišeš novu, svako
> ko vidi repo može falsifikovati link koji odobrava bilo kojeg korisnika.
> Zato gornji `notify_secret` MORA biti nova, nasumična vrijednost.

---

## 5. Dugmad "Odobri/Odbij" — deploy Edge Funkcije (opciono)

Potrebno **samo** ako želiš odobravati direktno iz poruke. Bez ovoga
obavještenja i dalje stižu, a odobrava se u aplikaciji.

```bash
npm install -g supabase
supabase login
supabase link --project-ref djguplhaayjvwmdlxevx
supabase functions deploy handle-registration-action --no-verify-jwt
```

`--no-verify-jwt` je **obavezan**: klik dolazi iz maila/Telegrama bez Supabase
sesije, pa bi Supabase inače vratio 401 prije nego kod uopšte provjeri token.
Sigurnost je HMAC potpis u linku, s rokom od 7 dana.

Secrets za ovu funkciju **ne treba** postavljati — tajnu čita iz `app_secrets`.
(Ranije je stajala i u SQL-u i u Supabase secretima, pa je najčešći kvar bio da
se te dvije vrijednosti raziđu.)

---

## 6. Provjera

U aplikaciji: **Postavke → 📨 Pošalji probno obavještenje**.

Ako ništa ne stigne, u SQL Editoru pogledaj šta je server odgovorio:

```sql
select id, status_code, left(content, 300) as odgovor, error_msg, created
from net._http_response order by created desc limit 20;
```

| Šta vidiš | Šta znači |
|---|---|
| nema nijednog reda | trigger se nije okinuo — provjeri `select extname from pg_extension where extname='pg_net';` |
| `error_msg` popunjen, status prazan | poziv nije izašao (mreža/DNS) |
| Telegram `401` / `404` | pogrešan `telegram_token` |
| Telegram `400 chat not found` | pogrešan `telegram_chat_id`, ili nisi poslao botu prvu poruku |
| Resend `401` | pogrešan `resend_api_key` |
| Resend `403` / `422` | `resend_from` domena nije verifikovana |
| `200` a ništa ne stiže | provjeri spam; za email i da lista primalaca nije prazna |

Provjera dugmadi: klikni "Odobri" u poruci — mora se otvoriti stranica s
potvrdom, a u bazi:
```sql
select ime, prezime, odobren from korisnici where id = '<uid iz linka>';
```

---

## Kako to radi (ukratko)

1. Registracija → `INSERT INTO korisnici` (`odobren = false`).
2. Trigger `trg_notify_new_registration` → `_posalji_obavjestenje()`.
3. Ta funkcija pročita tajne iz `app_secrets`, potpiše linkove (HMAC, rok 7
   dana) i preko `pg_net` pošalje POST na Telegram i/ili Resend.
4. Klik na dugme → Edge Funkcija `handle-registration-action` provjeri potpis i
   rok, pa service-role ključem postavi `odobren`.
5. Neovisno o svemu: admin u aplikaciji vidi brojčanik na tabu **Korisnici**
   (osvježava se pri pokretanju i pri svakom povratku u prvi plan).

Slanje je u cijelosti u `EXCEPTION WHEN OTHERS THEN NULL` — problem sa
obavještenjem **nikad** ne smije srušiti registraciju korisnika.

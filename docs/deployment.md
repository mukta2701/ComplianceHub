# Deployment

## Managed reference deployment

1. Create a managed Supabase project in a UK region where available.
2. Apply committed migrations and seed only approved catalogue content.
3. Configure Vercel with the variables from `.env.example`.
4. Keep the service-role key server-only and set a high-entropy cron secret.
5. Configure a custom SMTP provider, verified application URL, spend controls, monitoring, and database backups.
6. Exercise a restore into a separate project before public launch.

The Supabase free tier is suitable for development, not dependable production: projects may pause and production backup guarantees are limited. Vercel Hobby is limited to qualifying non-commercial use.

## Daily automation cron

`vercel.json` declares a cron entry (`0 6 * * *`) that calls `GET /api/cron/daily` once a day. Vercel Cron sends the request with an `Authorization: Bearer <CRON_SECRET>` header, so `CRON_SECRET` must be set to a high-entropy value in the Vercel project's environment variables — the route rejects any request whose bearer token does not match. The sweep is idempotent: notifications are deduplicated per day, and it only opens a new evidence-expiry task while none is already open for that evidence item, so re-running it — via Vercel's own retry or a manual call — is safe.

To invoke it manually in development:

```bash
curl -i -X GET http://localhost:3000/api/cron/daily \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Self-hosting

Use the official Supabase Docker distribution and deploy the Next.js container behind TLS. The operator owns patching, availability, monitoring, backups, recovery testing, email delivery, and secret rotation.

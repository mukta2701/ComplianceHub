# Deployment

## Managed reference deployment

1. Create a managed Supabase project in a UK region where available.
2. Apply committed migrations and seed only approved catalogue content.
3. Configure Vercel with the variables from `.env.example`.
4. Keep the service-role key server-only and set a high-entropy cron secret.
5. Configure a custom SMTP provider, verified application URL, spend controls, monitoring, and database backups.
6. Exercise a restore into a separate project before public launch.

The Supabase free tier is suitable for development, not dependable production: projects may pause and production backup guarantees are limited. Vercel Hobby is limited to qualifying non-commercial use.

## Self-hosting

Use the official Supabase Docker distribution and deploy the Next.js container behind TLS. The operator owns patching, availability, monitoring, backups, recovery testing, email delivery, and secret rotation.

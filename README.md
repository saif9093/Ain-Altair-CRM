# Ain AlTair Lead Intelligence

AI-assisted business prospecting, lead research and CRM for Ain AlTair. Search any niche in any location, research each business's digital presence, qualify it, and move the good ones into a sales pipeline.

**Stack:** Next.js 15 (App Router, TypeScript) · Supabase (Postgres, Auth, RLS) · Postgres-backed job queue · Claude (Anthropic API) · Tailwind CSS with Ain AlTair brand tokens.

---

## Quick deploy (about 15 minutes)

1. **Create a Supabase project** at [supabase.com](https://supabase.com). The free tier is fine.
2. **Create the database.** In Supabase, open **SQL Editor**, paste the whole of `supabase/setup.sql` and click **Run**.
3. **Configure auth.** In **Authentication → URL Configuration**, set **Site URL** to your app URL (for example `https://ain-altair-crm.vercel.app`).
4. **Deploy to Vercel.** Import this GitHub repo at [vercel.com/new](https://vercel.com/new) and add these environment variables (see `.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase → Project Settings → API)
   - `SUPABASE_SERVICE_ROLE_KEY` (server only)
   - `CRON_SECRET`: any long random string
   - `NEXT_PUBLIC_APP_URL`: your Vercel URL
   - At least one lead source: `GOOGLE_PLACES_API_KEY` or `APIFY_TOKEN`. OpenStreetMap works without a key.
   - Optional: `ANTHROPIC_API_KEY` (AI features), `BRAVE_SEARCH_API_KEY`, `PAGESPEED_API_KEY`.
5. **Create the first Super Admin.** Open the app, click **Request access** and register. Then run this in the Supabase SQL editor:
   ```sql
   update public.profiles set status='ACTIVE', role_key='SUPER_ADMIN', approved_at=now()
   where lower(email)=lower('you@ainaltair.com');
   ```
6. **Run background jobs.** Lead searches are processed by a worker. Pick one:
   - **Vercel Cron.** `vercel.json` calls `/api/cron/worker` every minute. Per-minute crons need a Vercel Pro plan; on Hobby, crons run at most daily.
   - **Always-on worker (recommended).** On Railway, Render, Fly.io or any VM, run `npm ci && npm run worker` with the same environment variables. It processes the queue continuously and runs scheduled searches and follow-up reminders.
   - **Manual trigger.** `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP/api/cron/worker`

Everyone else then registers and waits for a Super Admin to approve them, or is invited from **Admin → Users → Invite** (invite links expire after 7 days).

## Local development

```bash
npm install
cp .env.example .env.local   # fill in Supabase + any providers
npm run dev                  # http://localhost:3000
npm run worker               # in a second terminal: processes searches
npm test                     # 90+ unit tests
npm run db:check             # applies all migrations + RLS tests to a throwaway Postgres
```

## Roles, permissions and lead assignment

Roles: `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `SALES` (BDO), `RESEARCHER` and `VIEWER`. The full matrix is in `src/lib/auth/permissions.ts`, which is also the source of the SQL seed. A test fails if the two drift apart.

- **Per-user permission controls.** In **Admin → Users → (user)**, grant or revoke any individual permission on top of the user's role. Admin permissions and pricing visibility can only be granted by a Super Admin.
- **Hidden pricing.** Recommended prices, estimated opportunity values and deal amounts live in a separate `lead_pricing` table. The database only returns it to users with `pricing.view`, which Super Admin and Admin have by default. BDOs never receive these amounts, in the UI or through the API. Price columns are also removed from their exports, and the AI assistant has no access to them.
- **Lead assignment.** Super Admin, Admin and Managers (`leads.assign`) can assign leads:
  - one at a time or in bulk from **Leads**, or from the lead page;
  - to one user or round-robin across several;
  - automatically on approval, using the rules in **Admin → Scoring → Auto-assignment**.

  Reassigning more than 200 leads needs Super Admin approval. Assignees get a notification.
- **Visibility.** Sales users see only their own leads. Managers see their team's leads plus unassigned leads. `leads.view_all` sees everything. This is enforced by Postgres row-level security (RLS), not just the UI.
- **Approvals.** Large imports, bulk archive or delete, mass reassignment and role elevation create approval requests for a Super Admin. Every decision is written to the audit log.

## How a lead search works

1. **Search.** Type a natural-language request, for example *"Cleaning companies in Dubai with 20+ reviews, no website, WhatsApp"*. The rule-based parser, plus Claude if it is configured, shows how it understood the request. You can adjust it in the visual builder, preview it, then run it.
2. **Plan.** Locations are geocoded with OpenStreetMap Nominatim. Large areas are split into grid cells, and cells already searched recently are skipped.
3. **Collect.** Each configured provider (Google Places, Apify, OpenStreetMap) is queried page by page.
   - If one provider fails, the others continue, and the job shows each provider's status.
   - Every raw payload is stored in `source_records`.
4. **Normalise and deduplicate.**
   - Names, international phone numbers, URLs and emails are normalised.
   - A record is linked to an existing business only on a hard identifier (place ID, or phone or domain plus a similar name).
   - Weaker matches become duplicate candidates for a person to review. Nothing is merged silently.
5. **Enrich and audit.**
   - Website discovery uses Brave Search. The homepage audit is protected against requests to internal networks (SSRF) and respects robots.txt.
   - WhatsApp, email and social links are taken from the business's own site.
   - PageSpeed (Lighthouse) runs on Deep searches, and Instagram activity is checked through Apify.
   - A site is only called "slow" when that was actually measured.
6. **Score and qualify.**
   - Lead score uses configurable weights (20/35/15/20/10 by default).
   - Sales intent is a labelled estimate.
   - The opportunity engine works out what to sell, and price recommendations are visible only with `pricing.view`.
   - Qualification uses your filters. Unknown data goes to review instead of being rejected.
7. **Review.** Results sit in a staging area: Raw, Qualified, Review required, Rejected or Approved. **Approve to CRM** checks the quality gates first.
8. **Change detection.** Scheduled re-runs compare snapshots and flag new websites, broken sites, review growth and new opportunities.

AI output is always labelled as AI and kept separate from observed facts. If a provider isn't configured, the app shows **NOT CONFIGURED** with setup steps. It never returns fake data.

## Providers

| Provider | Env | Purpose |
|---|---|---|
| Google Places API (New) | `GOOGLE_PLACES_API_KEY` | Official business listings |
| Apify Google Maps actor | `APIFY_TOKEN` | Maps listings (+ optional contacts) |
| OpenStreetMap Overpass | none | Free fallback discovery |
| Nominatim | none | Geocoding |
| Brave Search | `BRAVE_SEARCH_API_KEY` | Find websites & social profiles |
| PageSpeed Insights | `PAGESPEED_API_KEY` | Measured performance |
| Apify Instagram | `APIFY_TOKEN` | Public follower / last-post data |
| Claude | `ANTHROPIC_API_KEY` | Interpretation, lead analysis, assistant |
| Google Sheets | `GOOGLE_SERVICE_ACCOUNT_*` | Optional import/export |

Enable, disable, prioritise (for fallback order), rate-limit and set quotas in **Admin → Providers**. Secrets are only ever read from server environment variables.

## Imports and exports

- **Imports** accept XLSX, CSV or a Google Sheet. You confirm the column mapping, pick a mode (Add only, Update existing or Upsert) and a match key (Lead ID, phone, domain or Google ID), and see a preview of new, updated, duplicate and invalid rows before anything is written.
- **Exports** come as formatted XLSX with clickable links, CSV, JSON or a Google Sheet. Files are named `AIN_ALTAIR_LEADS_YYYY-MM-DD.xlsx`.

## Security

- RLS is enabled on every table.
- The service role is used only server-side, after a permission check.
- The audit log is append-only, enforced by a trigger.
- A database trigger blocks users from changing their own role.
- The website auditor blocks requests to internal networks (SSRF).
- Inputs are validated server-side with zod.
- Lead deletion is a soft archive by default; permanent deletion is Super Admin only.

## Troubleshooting

- **Search stuck on QUEUED.** No worker is running. See step 6 of Quick deploy.
- **"No discovery provider is configured."** Add `GOOGLE_PLACES_API_KEY` or `APIFY_TOKEN`, or enable OpenStreetMap in **Admin → Providers**.
- **Login works but the app shows "Awaiting approval".** A Super Admin has to approve you. For the very first user, see step 5 of Quick deploy.
- **Every page redirects to /setup.** The Supabase environment variables are missing.

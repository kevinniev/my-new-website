# AVfreelance External Automation Engine

This repository powers all scheduled automation for the AVfreelance platform, running entirely on **Vercel Serverless Functions + Cron Jobs** — zero Manus credits consumed.

## Architecture

```
AVfreelance Platform (Manus)
        ↕  REST webhooks
Vercel Functions (/api/*)
        ↕  Social APIs
Facebook · Instagram · X · Threads · LinkedIn
```

Manus becomes the **UI, dashboard, and data viewer**. Vercel handles all heavy lifting.

---

## Directory Structure

```
/api/cron/           ← Vercel cron jobs (scheduled)
  social-feed-refresh.js    every 5 min  — pull live AV requests from social
  engagement-detector.js    every hour   — detect new engagements on all platforms
  engagement-engine.js      daily 7 AM   — full engagement outreach cycle
  analytics-sync.js         daily 8 AM   — sync analytics to AVfreelance
  partner-job-pull.js       daily 9 AM   — pull & sync partner job listings
  daily-crm-update.js       daily 11 AM  — update CRM with new leads/contacts
  daily-report.js           daily 12 PM  — send daily summary report
  posting-queue.js          daily 10 AM  — process scheduled social posts

/functions/          ← On-demand serverless functions
  autopost.js               POST /api/autopost — trigger a social post immediately

/lib/                ← Shared utilities
  avfreelance.js            AVfreelance API client (all platform calls)
  social.js                 Social media posting helpers (FB/IG/X/Threads/LI)
  auth.js                   Cron authentication guard
  logger.js                 Structured logging utility

/api/webhooks/       ← Webhook receivers
  trigger-job.js            POST — trigger a specific automation job
  job-result.js             POST — receive results from external jobs
  crm-update.js             POST — update CRM data
  analytics-update.js       POST — update dashboard analytics

/.env.example        ← All required environment variables
/vercel.json         ← Cron schedule + function config
```

---

## Cron Schedule

| Job | Schedule | Purpose |
|-----|----------|---------|
| Social Feed Refresh | Every 5 min | Pull live AV requests from social media |
| Engagement Detector | Every hour | Detect new likes, comments, follows |
| Engagement Engine | Daily 7:00 AM UTC | Full outreach cycle (DMs, invites, emails) |
| Analytics Sync | Daily 8:00 AM UTC | Sync platform analytics to AVfreelance |
| Partner Job Pull | Daily 9:00 AM UTC | Ingest partner company job listings |
| Posting Queue | Daily 10:00 AM UTC | Process scheduled social media posts |
| Daily CRM Update | Daily 11:00 AM UTC | Update CRM with new leads and contacts |
| Daily Report | Daily 12:00 PM UTC | Send daily summary to admin |

---

## Environment Variables

Copy `.env.example` to `.env.local` for local development, and add all variables to **Vercel → Settings → Environment Variables** for production.

### AVfreelance Platform
```
AVFREELANCE_API_URL=https://avtechplat-fvtswbiw.manus.space
AVFREELANCE_API_KEY=<your-api-key>
AVFREELANCE_WEBHOOK_SECRET=<webhook-signing-secret>
CRON_SECRET=<random-secret-for-cron-auth>
```

### Facebook / Instagram
```
FACEBOOK_PAGE_ACCESS_TOKEN=<page-access-token>
FACEBOOK_PAGE_ID=<page-id>
FACEBOOK_APP_ID=<app-id>
FACEBOOK_APP_SECRET=<app-secret>
INSTAGRAM_ACCESS_TOKEN=<instagram-graph-token>
INSTAGRAM_BUSINESS_ACCOUNT_ID=<ig-business-id>
```

### X (Twitter)
```
TWITTER_API_KEY=<api-key>
TWITTER_API_SECRET=<api-secret>
TWITTER_ACCESS_TOKEN=<access-token>
TWITTER_ACCESS_SECRET=<access-secret>
TWITTER_BEARER_TOKEN=<bearer-token>
```

### Threads
```
THREADS_ACCESS_TOKEN=<threads-access-token>
THREADS_USER_ID=<threads-user-id>
```

### LinkedIn
```
LINKEDIN_ACCESS_TOKEN=<linkedin-access-token>
LINKEDIN_ORGANIZATION_ID=<org-id>
```

---

## Deployment

### 1. Connect to Vercel
```bash
npm i -g vercel
vercel login
vercel link   # link to your Vercel project
```

### 2. Add Environment Variables
Go to **Vercel Dashboard → Your Project → Settings → Environment Variables** and add all variables from `.env.example`.

### 3. Deploy
```bash
vercel --prod
```

Vercel automatically picks up `vercel.json` and schedules all cron jobs.

---

## External Automation Mode Toggle

In the AVfreelance Admin Dashboard → **Distribution Hub** tab, there is an **External Automation Mode** toggle:

- **OFF** (default): Manus internal heartbeat jobs run normally
- **ON**: Manus stops internal jobs; Vercel handles everything

Toggle this ON after deploying to Vercel and confirming all cron jobs are running.

---

## Webhook Integration

AVfreelance exposes these webhook endpoints for Vercel to call:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/webhooks/social-scan-results` | POST | Receive social scan results |
| `/api/webhooks/post-result` | POST | Receive posting results |
| `/api/webhooks/analytics-update` | POST | Push analytics data |
| `/api/webhooks/partner-jobs` | POST | Push partner job listings |
| `/api/webhooks/crm-update` | POST | Update CRM records |

All webhooks require `x-webhook-secret` header matching `AVFREELANCE_WEBHOOK_SECRET`.

---

## Local Development

```bash
npm install
vercel dev   # runs functions locally on port 3000
```

Test a cron job manually:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/social-feed-refresh
```
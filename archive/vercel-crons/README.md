# Archived Vercel Cron Definitions

The production `main` branch historically declared 14 Vercel cron paths. They are preserved in `legacy-main-vercel.json` as a non-executable historical record.

The active configuration on this branch is `vercel.json`, which intentionally contains **no `crons` property**. Vercel Cron Jobs is separately disabled at the project level. Restoring any archived schedule requires a new design review, explicit approval, fresh deployment validation, and a category-specific side-effect authorization.

This archive is not a Vercel configuration file and must not be copied into a deployable root configuration without that separate approval.

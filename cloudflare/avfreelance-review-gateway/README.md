# AVfreelance Review Gateway

This Cloudflare Worker source is a **non-deployed, zero-dispatch review gateway**. It accepts only the fixed allowlist of review operations and returns a manifest stating that dispatch, provider calls, and data mutations are disabled.

It has no deployment configuration, route, queue, scheduled trigger, binding, or secret. Deploying it or adding a trigger requires separate approval after signed authentication, durable idempotency, a rollback plan, and category-specific side-effect approval are in place.

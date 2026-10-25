# Bounded read-only retries

Repeat exactly the same allowlisted read request at most twice after HTTP 429. Respect Retry-After integer seconds or HTTP date; missing/invalid values use one then two seconds. Every attempt preserves endpoint pacing and counts toward 180 requests. Never wait beyond the shared four-minute run budget; abort interrupts waits. Discard error bodies unread. Preserve complete-snapshot publication and fresh authorization after network work.

Safe failure diagnostics contain only fixed provider/code, allowlisted operation path without origin/query, HTTP status, attempt, and numeric retry delay. Never log headers, credentials, response bodies, arbitrary exception messages, or private product data. Existing frontend DTOs and persisted warehouse state remain unchanged.

Standing user authorization and AGENTS.md permit autonomous small fixes, agents, and verified local commits; this takes precedence over the discovery skill's manual checkpoint defaults.

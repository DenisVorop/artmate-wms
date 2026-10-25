# Progress

## Now

Complete: both approved read-only keys saved through WMS UI, and complete snapshots from both providers verified in the running application. WB succeeded at 25 October 23:57 Moscow; Ozon at 26 October 00:04 Moscow. UI shows 42 unmapped cards. Product mapping remains an explicit manager action; only test local themes currently exist.

## Evidence

Ozon official changelog (25 September 2026): https://dev.ozon.ru/news/802-Zagolovki-dlia-upravleniia-reit-limitami-v-Seller-API/ documents Retry-After seconds on HTTP 429. A 429 alone does not establish whether another integration shares the account limit.

## Log

- User approved reviewed key permissions, creation, WB warning, and storage in local WMS.
- Keys created and stored; raw in-memory browser variables cleared. No secrets in task files.
- WB import succeeded. Ozon rate limited twice; previous complete data and stock ledger preserved.

- Added bounded HTTP 429 retries, Retry-After support, safe fixed-operation diagnostics, and ten focused tests.
- Verification: full API suite 190 passed, two optional PostgreSQL tests skipped; API typecheck/build and FSD architecture check passed. Main API rebuilt and restarted; database and saved credentials retained.
- First post-update Ozon attempt reached analytics/stocks and returned HTTP 500. One later UI-triggered import succeeded completely; no provider/schema workaround was necessary.
- Screenshot of both successful connection cards saved in the chat output folder, outside version control. Keys never included in task documents or Git.
- No mappings, warehouse inventory, assembly tasks, or shipments created during connection verification.

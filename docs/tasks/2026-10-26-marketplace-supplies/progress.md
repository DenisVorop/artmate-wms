# Progress

## Now

Implementation and live verification complete. Sources promoted to the actual repository, existing DB and keys retained. Both credentials already have approved read permissions; no new credentials were created.

## Implemented

- Persist sanitized supply documents and per-product inbound in ordinary complete snapshots, with legacy compatibility.
- WB status/date/counter rules and per-product unknown handling; Ozon documents separate from analytics transit. Fixed path allowlist, shared WB supplies pacing and existing overall budgets.
- Plan automatically uses per-product API quantities including explicit zero; multipliers once; manual aggregate remains optional override. Documents/provenance UI via Swagger/Orval and FSD.
- Tests cover persistence, mapping projection, warehouse invariants, date filters, partial acceptance, missing values, old documents, duplicates/pagination, 83 Ozon documents, retry pacing and forecast arithmetic.

## Validation

- Full yarn test: API215 pass /2 optional skips; web376 pass. Subsequent focused tests after live-discovered fixes: WB+provider19 pass; Ozon10 pass; final WB calendar11 pass; service/HTTP2 pass.
- yarn check-types, yarn lint (385 FSD source files), yarn build in staging; production build and final API typecheck pass in actual repository.
- Live first attempts preserved previous data: WB rejected full timestamp date filters400; changed to ISO calendar dates (Moscow); Ozon83 open supplies exceeded initial40 cap; increased to100 within unchanged shared budget and added regression.
- Sync now uses the configured history (28days here) rather than an implicit 56day minimum: Ozon v3 postings maximum100/page; 56days plus83 bundles exceeded the unchanged180-request budget. A subsequent Ozon analytics500 was an upstream temporary error; previous complete snapshot remained intact.
- Initial and post-deployment state hashes verified36 tables/metadata/credential digest unchanged; final verification after both successful imports also passed.

## Live result

- Ordinary UI sync succeeded: WB5 documents (2 calculation/1 review/2 excluded), Ozon83 documents; snapshots persisted in PostgreSQL and survived application reload. Both connection cards show success.
- All42 mappings still connect21 real SKU themes; no stock, ledger, tasks, layout, labels, authentication or credential changes.36 invariant checks passed.
- Browser: Winter needs2 boxes/40units, API inbound0; Cats-2 inbound750 (WB220+Ozon530), no extra assembly; Mandalas inbound unknown only for its stale WB supply. No tasks created.
- Screenshots in chat workspace output/marketplace-supplies/imports.png and planning.png, outside Git.
- Final local Conventional Commit; no push.

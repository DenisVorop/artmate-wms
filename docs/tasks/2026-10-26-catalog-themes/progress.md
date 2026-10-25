# Progress

## Now

Completed: created 21 real SKUs (20 colouring themes and one marker-set SKU), and explicitly saved all 42 mappings through the authenticated internal-browser WMS UI. After reload, every provider pair has one shared skuId and unitsPerItem=1; unmapped count is zero. The two original test themes remain intact.

## Log

- Reviewed article/title/barcode pairs. Two distinct Kittens variants and two Landscapes variants remain separate.
- Marker norm chosen as four sets, one of user-provided valid options (four or eight); colouring norm twenty books.
- Prepared private reviewed pairing manifest outside Git.

- Added manager-only createSku with trimmed DTO/domain checks, matching-barcode reuse, conflicting-metadata rollback, and normal transaction/auth/replay/revision/activity flow. Added compact RHF/Zod form through generated Swagger/Orval and existing warehouse command transport.
- User confirmed marker box norm can be four or eight sets; selected four and told the user before creation. Colouring norm remains twenty books per box. Main barcode prefers a shared manufacturer code; no OZN code used as the physical main barcode.
- Full checks passed: API 193 tests with two optional skips, web 373 tests, typecheck, FSD384, production builds in staging and main. New HTTP suite checks anonymous/employee/CSRF/fresh-role denial and manager success.
- Created all 21 records without fabricated receipts, then saved 42 mappings one by one via UI. Reloaded and read selected DOM option values: 42 mapped cards, 21 unique target IDs, each pair shares the expected target and unit multiplier one.
- Before/after hashes match for 35 remaining tables/warehouse metadata, including existing stock, ledger, tasks, receipts, snapshots, credentials and auth. Only SKUs, catalogue activities, revision, normal command receipts and marketplace mappings changed.
- Browser screenshot and private reviewed/verified pairing manifests saved to chat output outside version control. No real seller data or secrets committed.

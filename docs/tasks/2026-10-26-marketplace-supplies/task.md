# Persistent marketplace supply import

User requests permanent import of WB and Ozon supplies, automatically reflected in assembly planning. Reuse ordinary marketplace data synchronization and persist sanitized documents/quantity sources in complete snapshots. No ad hoc secret readers in shipped functionality. Keep existing manager-only sync and explicit task creation; do not create assembly tasks or physical warehouse stock.

Acceptance: normal WB/Ozon sync imports supply data; forecast reads per-product API inbound including explicit known zero; Ozon analytics and documents never add the same supply twice; planned/completed/stale records correctly categorized; UI exposes provenance and review conditions; source and types generated through Swagger/Orval; full tests/build/live verification and local commit.

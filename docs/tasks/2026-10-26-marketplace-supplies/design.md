# Design

Existing JSON snapshots gain optional typed inbound[] and supplies[] (legacy compatibility, no destructive migration). API inbound is resolved per external product instead of a global all-SKU coverage flag. Unknown remains null. Per-product old/ambiguous supply blocks only that product. Manual aggregate remains an explicit override with its existing reset-after-sync semantics.

WB statuses1/2/3 are planned, not physically handed over; 4 receiving and6 handed over use declared quantity minus cumulative ready-for-sale quantity as an expected pending amount, explicitly an estimate; final status5 uses accepted minus ready, never original shortage. Invalid/missing counts cannot become zero. Handed-over records older than30days are review, excluded from automatic supply and cause null only for affected products. No arbitrary expiration silently converts unknown to zero. Aggregate goods across variants/documents exactly once; duplicate supplies/goods invalid. Completed documents without residual pending do not contribute.

Ozon transit_stock_count from analytics remains sole numerical inbound source, perSKU and summed across warehouses. Supply-order v3 list/get plus bundle v1 are imported as document evidence; quantities are not added to analytics. Unknown or absent analytics perSKU stays unknown. Forecast multiplies external units by unitsPerItem once.

All supplier HTTP paths fixed/allowlisted, numeric WB ID only in the one goods route; sanitized diagnostic uses placeholder path. Preserve redirects denied, shared4minute/180request/80MB budget and WB supplies2.1second shared pacing per attempt. Network outside warehouse lock, fresh manager auth/version after waiting, no auto task creation. Import on the existing Load Data action; this feature does not add a scheduler.

User autonomy and AGENTS authorize agents, implementation, verification and local commits, overriding discovery manual checkpoints. UI keeps existing glass/dark tokens and FSD; reusable API DTO shapes come only from Swagger/Orval.

# Сейчас

Реализация и выпуск завершены. Production работает на 127.0.0.1:3080; осталось создать локальный коммит.

## Результат

Конструктор: отдельная кнопка «Рабочая зона», назначение и existing locationIds, атомарная генерация кода/имени, настройка, корзина/restore, подсветка, печатный стабильный QR. Адреса и вместимость не дублируются.

Рабочее место: `/work` по умолчанию ждёт QR зоны. Реальный QR через общий gateway выбирает/возобновляет работу серверной командой, обычный barcode синхронно идёт в очередь. JobId/palletId/zone/mode удерживаются при pending/dirty. После завершения операции сервер назначает следующую в той же зоне. В пустой зоне — явная проверка очереди или другой QR. Manual fallback сохраняется, выход через leaveZoneWork.

Shipping: только собственное назначение, сканы точного reserved набора, обзор состава и явная отправка. Незавершённый короб, перенос и частично проверенная отгрузка защищены от смены зоны. Recovery разрешает только явную отмену failed unsent queue; inflight и сохранённые факты не отменяются.

## Проверки

- Staging web 298/298 PASS, TypeScript PASS, FSD316 PASS.
- API последний PGlite 121 PASS +1 optional PG concurrency SKIP; полный реальный PostgreSQL121/121 PASS, затем последние guards focused9/9 PASS.
- Additive schema12: в изолированной zone_preview все29 прежних таблиц и warehouse geometry/metadata сохранены, новая schema12; workZones/zoneWork пустые defaults без перезаписи cachedJSON.
- Браузерная функциональная проверка: создание зоны с пустыми кодом/именем → WZ-01; QR/printready; код ячейки отклонён на входе зоны; QRсборки автоматически claim, повтор resume; source/box/6rapididentical→6/20; другая зона посреди короба отклонена, 14сканов закрыли короб; приёмкаQR→назначеннаяпаллета→адрес→баланс; shippingQR→exactboxscan→review→namedfinish→idle; putawayQR→take/place→auto-nextbox→take/place безповторногоQR, carryswitchотклонён; failedscan→явныйdiscard→продолжение.
- Read-only review: исправлены pin всех render context при pending/dirty, resumeworking при failed queue и доставка recovery-notice из PairScan. Backend actor/session/replay/concurrency/projection/stockwrite review без P1.

Архитектура: ADR050–052, README, AGENTS, ARCHITECTURE. Тестовые аккаунты/данные, логи и скриншоты вне репозитория. Телефон, настоящий сканер и физическая печать требуют проверки на оборудовании.

## Выпуск

Резервная копия `.data/backups/before-work-zones-20261024.dump` (0600). В основном checkout: check-types PASS, lint/FSD316 PASS, API121 PASS+1optionalSKIP, web298/298PASS, buildPASS. После запуска additive schema12 все29 прежних таблиц основной БД (включая ledger, cachedcommands, auth, workforce, stocktakes) и геометрия/прежняя metadata сохранены точно. WorkZones/zoneWork не созданы автоматически. Основной первый вход сохранён без автоматического создания руководителя.

Галерея3090 обновлена скриншотами нового сценария; изображения и тестовая БД вне репозитория. Конкретная ширина390CSSpx в этом этапе не подтверждена: browser viewport override не изменял измеренный innerWidth, поэтому точный mobile-breakpoint не заявляется. Функциональные сценарии и компактная колонка проверены в браузере.

# Освобождение адреса сырья

Пользователь уточнил: при полном расходе сырьевой паллеты во время сборки адрес считается свободным сразу. Дождаться отгрузки нельзя.

Код: warehouse.service.ts scanTask, тексты inventory/location-details. Решение: docs/decisions/062-assembly-source-release.md. Проверки: raw-pallet-release.test.ts и существующие warehouse/workforce regression.

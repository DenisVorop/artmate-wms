# ADR082: переносимая инфраструктура релиза

Дата:2026-10-27. Статус: принято для подготовки, площадка не выбрана.

## Решение

WMS остаётся отдельным репозиторием/Compose-проектом и отдельной БД. Образы
Node24 multistage: Nest compiled runtime и Next standalone; Swagger/Orval только
при build. API/Web работают non-root, без записи в корневую ФС; только PG имеет
постоянный том данных. Web same-origin proxy фиксирует DNS artmate-wms-api-internal:4080 при build.

Базовый Compose не публикует портов. Отдельный edge overlay даёт Caddy HTTPS;
Artmate overlay подключает только Web к существующей external-сети с уникальным
alias. WMS сохраняет свои host-only Secure cookies и разрешение камеры(self).
Reference Caddy/секреты/БД соседнего проекта автоматически не изменяются.

Production executable требует PostgreSQL DSN, точные HTTPS origins, Secure cookie
и внешний32-byte encryption key; свежая БД без demo. DI/OpenAPI остаются offline.
Миграции тем же versioned initialization запускаются отдельной командой без
планировщиков. Main — единственный владелец graceful shutdown; сперва завершает
все фоновые операции, затем закрывает SQL. Один API instance на первом релизе.

Deploy ручной, immutable SHA/digest, с остановкой writers, предварительным backup,
миграцией и readiness. Restore только в новую БД, с checksum/явным target/confirm,
без перезаписи. Cutover выбирает новую БД в защищённом env, сохраняя прежнюю.
Исходный master-key переносится вместе с полным архивом; новый ключ не подменяет
старый. CI проверяет контейнеры и восстановление, publish запускается вручную;
автоматического SSH/deploy нет.

## Последствия

Можно выбрать отдельный хост или поддомен Artmate без переработки приложения.
Первый перенос требует окна без складских записей и без двух активных импортёров.
Публичные DNS/сертификат, ресурсы VPS, GHCR и offsite backup проверяются при выборе
площадки. Healthcheck и локальный smoke не означают промышленную готовность без
проверки на настоящем телефоне/принтере и восстановления production-копии.

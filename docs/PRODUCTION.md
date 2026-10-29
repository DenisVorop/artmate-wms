# Рабочая WMS

Первый production-релиз выполнен 2026-10-29 по запросу пользователя.

- Руководителю: https://wms.artmate.ru/planning.
- Сотруднику: https://wms.artmate.ru/work.
- VPS Aeza: 178.236.242.215, отдельный от сайта Artmate.
- PostgreSQL database: `artmate_wms_import`, Compose project: `artmate-wms`.
- Активная версия: `/opt/artmate-wms/shared/current-release.json`.
- Защищённый env: `/opt/artmate-wms/shared/.env.production`, owner wms-deploy,0600.

Вход с прежними аккаунтами и паролями. Cookie нового HTTPS-домена отдельная,
поэтому после переключения требуется обычный вход.

## Доказательства первого переноса

Локальные API, web и телефонный шлюз штатно остановлены перед pg_dump.
Полный PostgreSQL15 custom dump восстановлен в новую PostgreSQL17 database.
Перед запуском приложения совпали количество и хеш содержимого всех 55 public
таблиц: склад, партии/FIFO, аккаунты, сессии, журнал, история продаж и прогнозы.
Сохранены 100987 фактов истории, 175 записей журнала прогнозов и 2 аккаунта.
Исходный 32-byte master key проверен расшифровкой обоих операционных подключений
и финансового ключа WB. Сам ключ, env и dump в Git не входят.

Публикация [40911762630](https://github.com/DenisVorop/artmate-wms/actions/runs/40911762630)
и deployment [40914910221](https://github.com/DenisVorop/artmate-wms/actions/runs/40914910221)
успешны. SHA `ff127e3ce666555c8f0c54808af611a293e9009c`:

- API digest `sha256:c7f8e3384b0a488d60345939372713b0835cf117cc5397895cf284e76bb370e0`.
- Web digest `sha256:873865082b8b61ece976092676eca710c9d700aac35c0c5f8aae165826dfa98c`.

DNS A `wms` указывает на новый VPS, Cloudflare DNS only.
Публичный TLS проверен без отключения проверки сертификата. HTTP перенаправляет
на HTTPS; `/healthz` отвечает ok; `/work` и `/planning` открывают вход;
`/api/auth/session` сообщает needsSetup=false; API прогнозов, подключений
и аккаунтов без сессии отвечает 401. API/БД не имеют опубликованных host ports.
Подмена авторизации и фиктивные складские операции при проверке не выполнялись.

Первые замеры после запуска: ~740 MiB RAM на всём VPS, четыре контейнера
healthy/работают, OOM=false и restart count 0. Это начальный замер, не гарантия
пикового потребления во время полной смены или массового пересчёта ML.
Фоновый прогноз после переноса уже сохранялся в production.
На момент переключения последний импорт Ozon имел прежнюю ошибку временной
недоступности маркетплейса (попытка 16:33 UTC, ещё до переноса); старая полная
загрузка сохранена. Планировщик продолжает штатный 30-минутный цикл.

## Ежедневные резервные копии

Установлены `artmate-wms-backup.service` и `artmate-wms-backup.timer`.
Запуск 03:15 Europe/Moscow, случайная задержка до 5 мин, Persistent=true.
Сервис работает от wms-deploy, UMask 0077, Node `/usr/local/bin/node`.
Wrapper в `/opt/artmate-wms/bin/backup-current.mjs` выбирает реальную директорию
из защищённого current-release.json и вызывает scripts/release/backup.mjs
именно этой версии. Не стартует приложение и не удаляет старые копии.
Во время deploy.lock запуск пропускается: сам rollout делает pre-migration backup.

Первый ручной запуск завершился Result=success/ExecMainStatus=0.
Копии хранятся в `/opt/artmate-wms/backups/*.dump` и `.manifest.json`, 0600.
Ключ шифрования хранится отдельно; без оригинального master key интеграции
не восстановятся. Ежедневные копии сейчас только на VPS.

С разрешения пользователя первая production-копия дополнительно скачана на Mac
в `.data/release/cutover-20261029/`, проверена по manifest/SHA256, права 0600.
Исходный снимок и fingerprints миграции также остаются там. Это первая внешняя
копия, а не автоматическая внешняя выгрузка. Внешнее хранилище пока не подключено.
Контролировать свободный диск и при необходимости отдельно согласовать retention.

Проверка и ручной запуск оператором:

```bash
ssh artmate-wms 'systemctl list-timers artmate-wms-backup.timer --no-pager'
ssh artmate-wms 'systemctl start artmate-wms-backup.service'
ssh artmate-wms 'systemctl show artmate-wms-backup.service -p Result -p ExecMainStatus'
```

При установке на новый хост после первого успешного rollout:

```bash
install -d -o wms-deploy -g wms-deploy -m700 /opt/artmate-wms/bin
install -o wms-deploy -g wms-deploy -m600 scripts/release/backup-current.mjs /opt/artmate-wms/bin/backup-current.mjs
install -o root -g root -m644 infra/systemd/artmate-wms-backup.service.example /etc/systemd/system/artmate-wms-backup.service
install -o root -g root -m644 infra/systemd/artmate-wms-backup.timer.example /etc/systemd/system/artmate-wms-backup.timer
systemd-analyze verify /etc/systemd/system/artmate-wms-backup.service /etc/systemd/system/artmate-wms-backup.timer
systemctl daemon-reload
systemctl start artmate-wms-backup.service
systemctl enable --now artmate-wms-backup.timer
```

Это отдельная однократная установка стабильного wrapper, не часть автоматического
обновления приложения. При изменении wrapper переустановить его явно.

## Следующие релизы и восстановление

Следовать [GITHUB_DEPLOYMENT.md](GITHUB_DEPLOYMENT.md): CI→ручная публикация→
ручной deployment по полному SHA с ingress=edge. Shared env сохраняется,
app refs меняются только на проверенные digest. Новый мастер-ключ не генерировать.

Restore только в новую БД при остановленных writers, с проверкой manifest
и исходного ключа. Не делать down-v/prune/drop/автоматический rollback.
Локальный прежний API/schedulers не запускать с рабочими данными — учёт теперь
ведётся на VPS. Для разработки нужна отдельная БД без живых подключений.
Старый локальный PostgreSQL и исходный master key сохранены.

## Прямое исправление конструктора — 2026-10-29

Пользователь явно попросил не ждать пайплайны и сразу выложить исправление.
Поэтому API обновлён напрямую до проверенного SHA
`255e2991cf503ee6c9b239b16407e54ac52430dd`; frontend не менялся.
Локально прошли 557 API-тестов (2 optional skip), 442 web-теста, типы,
FSD lint и production build. Дополнительные CI checks и containers
также завершились успешно в фоне; их публикация не управляла прямым релизом.

Новый отдельный Docker image `artmate-wms-api:sha-255e2991cf503ee6c9b239b16407e54ac52430dd`
создан поверх прежнего pinned production API. Сверены все 98 runtime JS-файлов:
96 совпали, заменены только layout.js и warehouse.service.js, сверены их SHA256.
Файлы внутри действующего контейнера не редактировались. Web остаётся на прежнем
GHCR digest; его код в этом изменении совпадает. Точные base/image IDs,
artifact hashes и mode=direct-patch-user-requested записаны в current-release.json.

Прямой bundle:
`/opt/artmate-wms/releases/255e2991cf503ee6c9b239b16407e54ac52430dd-direct-20261029`.
В нём сохранены Dockerfile, patch-manifest, два скомпилированных файла, штатная
infra/release CLI и direct-deploy.mjs. Docker context разрешает только Dockerfile
и два patch-файла; конфигурация и резервные копии не входят в image.

Использован deploy.lock; до остановки создан checksum backup, API остановлен
штатно и пересоздан из нового образа. DB, master key, ресурсы, frontend и ingress
сохранены. Миграция не требовалась: schema18 не менялась. Внутренние и публичные
health/auth checks прошли; отдельный read-only probe на production подтвердил
разрешение assembly поверх aisle и запрет обычного floor.
Система ежедневных копий после переключения также проверена успешным запуском.

Образ сейчас локальный на VPS: не удалять и не retag этот SHA. Следующая
стандартная выкладка может заменить его опубликованным GHCR digest через прежний
пайплайн. Текущий прямой релиз не означает разрешение автоматически выкатывать
позднее завершившиеся фоновые публикации.

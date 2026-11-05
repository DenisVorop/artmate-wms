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

## Горизонтальные этикетки адресов — 2026-10-29

Web обновлён напрямую по постоянному запросу пользователя выкладывать изменения
без ожидания пайплайнов. Финальный webRevision:
`a1ca354d5132fe730229c1a615370a145860e86c` (шаблон: `1493742`).
API остался на `255e2991cf503ee6c9b239b16407e54ac52430dd`, его контейнер не
перезапускался; schema18, конфигурация, мастер-ключ и учёт сохранены.

Image `artmate-wms-web:a1ca354d5132fe730229c1a615370a145860e86c`, image ID
`sha256:836aa92e33737b4853ea08e6aaadf928a276f1fb925ed7fdffe84a01ac9b5b22`.
Directory:
`/opt/artmate-wms/releases/a1ca354d5132fe730229c1a615370a145860e86c-web-clean-20261029`.
Mode в current-release: `direct-web-update-user-requested`, apiRevision и
webRevision раздельные. Новый web использует plain commit tag, API сохраняет
свой прежний sha-tag. Не retag/prune локальные образы действующих релизов.

Из-за недоступного Docker registry frontend собран штатным `next build` локально
с production API DNS, затем portable standalone app/static помещены в новый
образ поверх прежнего Linux/amd64 runtime. yarn.lock, package.json, Next config
и Dockerfile не менялись относительно runtime; Linux node_modules сохранены.
Всё приложение .next заменено целиком, старые chunks в образе не смешивались.
Контрольные суммы всех 544 файлов проверены на VPS и внутри нового image.
Dockerfile, artifact-manifest и процедура выкладки находятся в release bundle.
Это отдельный immutable image; активный контейнер не редактировался.

После deploy.lock: отдельный read-only smoke-контейнер с loopback-портом и
лимитом 256 MiB проверил health, прокси к API и маршрут labels/a4, затем удалён.
Перед переключением web сохранён checksum backup
`before-web-labels-2026-10-29T19-13-17.574Z.dump`. Перезапущен только web,
конфигурация кроме WMS_WEB_IMAGE побайтно по значениям сохранена. Публичные
health/labels/auth, healthy/OOM, revision/image и разрешение текущего каталога
ежедневным backup wrapper проверены независимо. Shared env остаётся0600.

Проверки исходников:557 API pass,2 optional skip;445 web pass;check-types,
FSD lint, build. В браузере проверен реальный компонент на адресе A-07-01 и
дополнительных fixtures:120×75 мм, подписи и QR, без обрезания. Production-сессия
руководителя закончилась: авторизованный редактор печати в этой проверке не
проходился; его HTML-маршрут/статика и API proxy проверены контейнером.
Шаблон и границы FSD описаны в ADR085.

## Минимальные таблички рабочих зон

Web обновлён до `e35f7d2ce13e21ede023ae529149b26c8bef7fc0`: WorkZoneRollLabel
оставляет только QR и «Рабочая зона: сборка/размещение/приёмка/отгрузка».
Код, бренд, payload и повтор имени убраны. Шаблон общий для одиночной и массовой
печати120×75; named page назначается также корневому печатному контейнеру.
Браузерная проверка реального компонента: обе запрошенные зоны, без переполнения.
Подготовленный PDF пользователя:2 страницы120×75, QR сверены с исходником и
автоматически считаны после рендера203dpi.

557 API pass/2 optional skip,447 web pass, types/lint/Next build прошли.
Применена та же portable standalone процедура;544 файла проверены в образе.
Web image `artmate-wms-web:e35f7d2ce13e21ede023ae529149b26c8bef7fc0`, ID
`sha256:058525e731629ba487c88de15f4bb06a78f1218abc8e97bc74b34f341c04d12c`.
Bundle `/opt/artmate-wms/releases/e35f7d2ce13e21ede023ae529149b26c8bef7fc0-web-zones-20261029`.
Backup `before-web-labels-2026-10-29T19-39-27.065Z.dump` перед переключением.
API255e299 не перезапускался; PACK-01 и складской учёт не менялись.
Изолированный smoke и независимые публичные health/labels/session проверки прошли,
контейнеры healthy/OOM=false. Current-release содержит раздельные api/web revisions.

##42 короба и габарит загруженной европаллеты

API и web обновлены до `d45cb5fd4bcd27f880c6482e50c615e448d76df2`.
Изменение основано на подтверждении пользователя:короб450×350×200мм,6вслое с
выступом,7слоёв42;поддон1200×800,полныйгабарит1200×900×1550мм. Физический
расчёт использует optionalloadWidth/loadDepth с backward-compatible fallback,
новыеSKU получают актуальныйDEFAULT, старые снимки не переписаны. См.ADR086.

Текущий bundle:
`/opt/artmate-wms/releases/d45cb5fd4bcd27f880c6482e50c615e448d76df2-loaded-20261029`.
Images `artmate-wms-api:d45cb5fd4bcd27f880c6482e50c615e448d76df2` /
`artmate-wms-web:d45cb5fd4bcd27f880c6482e50c615e448d76df2`.
API ID `sha256:d550344e59e07ca9cd94f57e14adbb6e47e8f179268fb86d74a1ba1e10654315`,
web ID `sha256:bc8c1383019467433b67d5b83fb4b6a90ae5e19351811c791113725199e8ef96`.
Mode `direct-runtime-update-user-requested`, active manifest содержит642SHA256:
98compiledAPI +544portableweb. Dependencies/package manifests/lock не менялись;
образы собраны поверх прежних Linux runtime (API255e299, webbaseff127e3), только
API dist и web app/.next заменены целиком. Изображения в активном контейнере не
редактировались. Schema18, исходныйключ/конфигурация/учёт/ingress сохранены.

НаVPS до переключения проверены все642файла, pureAPIрасчёт42 и совместимость
старыхпрофилей, отдельный websmoke. Под deploy.lock создан backup
`before-loaded-release-2026-10-29T20-38-00.380Z.dump`, API штатно остановлен перед
запуском нового единственного API. Health/публичные маршруты, pinnedimage IDs
проверены независимо; автоматическогоrollback не было. Полные проверки исходников:
567APIpass/2optionalPostgreSQLskip;453webpass;types/lint/API+Nextbuild.

Конфигурация склада отдельно применена доменными транзакциями, revision405→406:
maxBoxes42 на102активныхадресах;16F-мест по900мм на14,4м;PACK/T1200×900;101известный
маршрут сохранён. Реальные высоты ярусов не повышались.
После rollout обновлены20реальных SKU раскрасок, revision407, marker
`maintenance:real-box-profiles:2026-10-29-450-350-200`. Незавершённой сборки не было;
маркеры/тестовыеSKU и immutableснимки сохранены. Backup
`before-real-box-profiles-2026-10-29T20-42-19.207Z.dump`. При сверке новыеJSONBключи
канонизируются рекурсивной сортировкой, иначе PostgreSQL меняет порядок ключей и
служебныйhash даёт ложное несоответствие; два предварительных отказа откатились
целиком, без частичного профиля/ledger/выработки. Итог:все20напольныхадресов
геометрически принимают42, пустой общий накопитель показываетcapacity42.

Браузер:изолированный реальный LocationForm, defaults1,2×0,9/1200×900/42,
переполнения по ширине нет. Авторизованный productionредактор не проходился:
сессия руководителя истекла; после выкладки проверены API/конфигурация/HTTP health.
После применения запущена свежая штатная резервная копия для нового состояния.


## Ограниченная очередь сборки — 2026-10-30

API source `1ed319b5cbec09b6863d133119088b25eb37e9d8` выложен напрямую по
сохраняющемуся разрешению пользователя. Web остаётся `d45cb5f`, не перезапускался.
Активный bundle:
`/opt/artmate-wms/releases/1ed319b5cbec09b6863d133119088b25eb37e9d8-queue-20261030`.
`current-release.json` содержит раздельные apiRevision/webRevision, оба image ID,
API artifact manifest и ссылку на прежний web manifest. Режим
`direct-api-update-user-requested`.

Образ API `artmate-wms-api:1ed319b5cbec09b6863d133119088b25eb37e9d8`, ID
`sha256:ea4492e9090b1b24853b89975f320be22ba703ce74546f6c8256feef7d8f26a3`,
построен на прежнем pinned Linux API image. Из 98 compiled JS изменился только
`work-automation/planning.js`; 97 остальных совпали побайтно с production base.
Зависимости, Compose, schema18 и настройки подключения не менялись. До остановки
проверены все checksum, OCI revision/source и compiled queue constants 5/10/20.

Резервная копия перед переключением:
`/opt/artmate-wms/backups/before-queue-release-2026-10-29T22-31-39.003Z.dump`.
Сохранены deploy.lock, graceful stop только API, прежние секреты и проверка
readiness → web API proxy → публичные HTTPS маршруты. Переключение успешно
`2026-10-29T22:31:50.017Z` (30 октября по Москве). Таймер ежедневных копий active.

Проверки: API 576 pass, 2 optional skip; web 453 pass; генерация Swagger/Orval,
типы обоих приложений, FSD lint и обе production-сборки успешны. После форматирования
теста планировщика его 17 проверок повторно прошли. В новой логике проверены
параллельные циклы, FIFO и завершение реального задания тестовыми сканами.
Пользовательские экраны и API DTO не менялись; новый браузерный прогон не требовался.

Фоновый цикл production после запуска проверен в `22:31:59.990Z`: незавершённых
сборочных задач 0; создание корректно ожидает подтверждённых готовых остатков,
размещённого сырья, актуального плана и свободных мест. Рабочий товар и тестовые
задания для проверки выкладки не создавались. Правила лимита и ротации — ADR080.


## Автоспуск сырья на доступные ярусы — 2026-10-30

API и web source `060d3690165fbf34dbb365bdcd2acbd1c5ab5985` выложены напрямую
по действующему разрешению пользователя, без ожидания pipeline. Active bundle:
`/opt/artmate-wms/releases/060d3690165fbf34dbb365bdcd2acbd1c5ab5985-access-20261030`.
`current-release.json` отмечает `direct-runtime-update-user-requested`, раздельные
revision, оба image ID, pinned bases и checksum полного artifact manifest.

Образы:
- API `artmate-wms-api:060d3690165fbf34dbb365bdcd2acbd1c5ab5985`, ID
  `sha256:80cdcdcb2e793c295a7d49a9b250b4f8a7851408da1092db21e50ff696b272d0`;
- web `artmate-wms-web:060d3690165fbf34dbb365bdcd2acbd1c5ab5985`, ID
  `sha256:74d9ab8dc3a2e09663567998544f7bff6508001222aef87130ab8c69b0f2faba`.

Проверены 643 runtime-файла: 99 compiled API JS и 544 web standalone/static.
От прежнего API изменились ровно девять ожидаемых файлов, включая новый
work-automation/raw-access.js; остальные прежние JS совпали. API base —1ed319b,
web base —d45cb5f; Linux dependencies, package manifests, lockfile и schema18
не менялись. Mac native modules и секреты в артефакт не включались.

Backup перед переключением:
`/opt/artmate-wms/backups/before-access-release-2026-10-29T23-43-56.490Z.dump`.
Действовали deploy.lock, проверка OCI/checksum и pure compiled guards до остановки,
web smoke с прежним API, backup, graceful switch API+web, readiness, web proxy и
публичные HTTPS health/warehouse/session. Секреты сохранены, автоматического
rollback нет. Переключение успешно `2026-10-29T23:44:13.080Z` (30 октября по Москве).
Ежедневный backup timer active; копии на Mac для этой выкладки не переносились.

Проверки: API 599 pass, 2 optional skip; web 458 pass; Swagger/Orval, оба typecheck,
FSD lint, формат и обе production-сборки успешны. 27 адресных проверок покрыли
спуск, FIFO, приёмку, HTTP и конкурентный цикл. Дополнительный независимый review
интеграции замечаний не выявил.

UI проверен через CUA на изолированном настоящем EmployeeMovements с тестовой
моделью команд без рабочей БД: контейнер 360 px, scrollWidth=360, кнопки около44px,
тематика25px; явное взятие и четыре скана дошли до подтверждения завершения.
Исходная ошибка отсутствующего QueryClient в стенде исправлена добавлением
штатного provider; это не ошибка production-приложения. Authenticated production
click-through и запрос карты из стенда не выполнялись; HTTP-доступ и маршруты
покрыты API-тестами. Временный сервер/вкладка закрыты. Артефакты проверки хранятся
в task workspace output/ui/raw-access-verification.json и снимке экрана.

После запуска production фоновый цикл проверен: активных автоспусков0, сборок0.
Единственная положительная raw-паллета на верхнем ярусе не выбрана, поскольку
она не старейшая партия своей тематики; pure read-only диагностика подтвердила
причину «Сначала нужна самая старая партия этой тематики». Тестовых заданий,
перемещений товара и корректировок остатков на production не делалось.
Правила добровольного автоспуска и разнообразия тематик описаны в ADR087.


## Восстановление отображения плана — 2026-11-05

Причина инцидента: forecast cache актуален (публикация22:36МСК), обе интеграции
success с совпадающими версиями, но все17строк требуют проверки. У16тематик
агрегатные остатки старше7дней, у маркеров количество приблизительное. После смены
настроек display cache несовместим; требование хотя бы одной dataComplete строки
возвращало unavailable, которое веб показывал как бесконечный пересчёт.

Исправление API `421adc619a551fd5fe40e9687fbc3b91d3fd6fc4` развёрнуто напрямую
по действующему разрешению пользователя. Web остался060d369 и не перезапускался.
Directory:
`/opt/artmate-wms/releases/421adc619a551fd5fe40e9687fbc3b91d3fd6fc4-review-plan-20261105`.
API image `artmate-wms-api:421adc619a551fd5fe40e9687fbc3b91d3fd6fc4`, ID
`sha256:9b74eb4c6b8be5158501b54c8930725215c16a2c32a80d06109e311150e6c386`.
Mode=direct-api-update-user-requested; раздельные apiRevision/webRevision,
immutable bases, image IDs и manifests записаны в current-release.json.

Из99compiledJS изменился только marketplaces/planning-presentation.js;
98остальных совпали с APIbase060d369. Зависимости, DTO, клиент, schema18,
учёт и алгоритмы прогнозирования не менялись. До переключения проверены OCI,
все checksum и compiled ready-review ветка с запретом записи в diagnostic tx.
Backup:
`/opt/artmate-wms/backups/before-review-plan-2026-11-05T19-55-47.479Z.dump`.
Сохранены deploy.lock, protected env, graceful stop только API, readiness,
web API proxy и публичные HTTPS проверки. Дампы на Mac не копировались.

Проверки: 28адресных API, полный API601pass/2optional skip, web458pass,
генерация контрактов, типы, FSDlint, формат и APIbuild прошли. Независимый
read-only review не выявил нарушения прежних guards. Webbundle остался прежним.

Одним и тем же SELECT-only diagnostic на рабочем состоянии сравнили до/после:
22:54:31МСК cacheCurrent=true,17review rows,0executable, state=unavailable/loading=true;
22:56:33МСК cacheCurrent=true,17review rows,0executable, state=current/loading=false,
сообщение «Расчёт готов. Для планирования сборки проверьте данные товаров».
Hash planning_stock_confirmations совпал до и после: дата и количество не обновлялись.
Диагностика отказывалась выполнять INSERT/UPDATE/DELETE; фиктивная HTTP-сессия
не создавалась. Полный browser click-through не выполнен: IAB показывал вход;
временная вкладка закрыта. Исправлена серверная проекция, которую читает прежний UI.
См. уточнение ADR072 о готовом прогнозе со строками проверки.


## Повторное восстановление плана и сохранение review — 2026-11-05

После получасового обновления Ozon завершился failed, WB опубликовал новый snapshot,
а forecast сначала ожидал новый ключ, затем успешно опубликовался. Прежний фикс
требовал success у всех подключений и не сохранял review-проекцию; UI опять стал
unavailable. Подтверждено SELECT-only диагностикой в23:03–23:06МСК.

API9f1bf0939039dc40f1b33f64862bf50399cf3514 выложен напрямую23:11МСК:
`/opt/artmate-wms/releases/9f1bf0939039dc40f1b33f64862bf50399cf3514-review-plan-20261105`.
Image `artmate-wms-api:9f1bf0939039dc40f1b33f64862bf50399cf3514`, ID
`sha256:3d7e99125ac9c00acc5de51e586febb52b31c5835773291cd3361a801b738d5a`.
Base421adc6, web060d369 не пересоздавался. Из99compiledJS изменился только
marketplaces/planning-presentation.js. Current-release.json сохраняет отдельный
webArtifactManifest от060d369, ссылки на immutable bases и checksums.
Backup: `/opt/artmate-wms/backups/before-review-plan-2026-11-05T20-10-44.245Z.dump`.
Миграций нет, schema18, секреты и склад сохранены. Backup/lock/graceful stop API,
readiness, web proxy и публичные HTTPS health успешны. Первые попытки остановились
до backup/switch из-за неполной fixture предрелизного probe; после использования
seedWorkspace/defaultSettings изолированный compiled probe прошёл обе ветки.

Проверки:49 адресных API-тестов, API typecheck/build, FSDlint и формат успешны.
Реальная manager-сессия в открытом Yandex через CUA: /planning после reload
показал17товаров, причины проверки и форму уточнения остатка в Подробнее.
Спиннер пересчёта исчез; DevTools закрыт, изменения форм не отправлялись.
Единственная увиденная console error — прежний favicon404. Native driver не
поддерживает network interception/viewport probes; они не объявляются пройденными.

SELECT-only проверка с диагностическим cacheCurrent=false (без записи состояния)
подтвердила durable previousPlan, state=refreshing/loading=false. Источник —
сохранённый review от23:12МСК,17строк,0допущенныхк созданию задач.
Hash planning_stock_confirmations остался тем же72ae1dd2daeb37caf95447b29fc4defc31ab4e0a6c48688a9415cdd7cf9f45d9.
Обычная текущая GET-проекция может сохранять display cache, поэтому её проверили
через настоящую авторизованную страницу; SELECT-only diagnostic отказывался
выполнять эти записи, без обхода авторизации или фиктивной сессии.
Evidence в task workspace: output/ui/planning-review-persistence-verification.json.

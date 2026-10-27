# Состояние

## Выполнено

- Подготовлены и реально собраны Docker targets API и Web (Node24, standalone Next). API включает compiled ML worker; PostgreSQL17 отдельно.
- В production обязательны явный DSN, HTTPS origin, Secure host-only cookie и существующий ключ. Новая БД пустая, существующий склад не перезаписывается. Миграции отдельным executable без планировщиков; shutdown завершает фоновые операции до SQL close.
- Compose проверен для private/edge/artmate вариантов; только Web попадает в proxy network. API/DB не публикуют порты. Caddy configuration прошла validate.
- Подготовлены init/preflight/deploy/backup/restore, ежедневный backup wrapper и systemd timer, CI и отдельная ручная публикация без SSH/deploy. Backup/restore защищены checksum и новым именем БД; cutover сохраняет прежнюю БД и исходный ключ.
- Типы и FSD прошли. API:557 тестов,555 успешных,2 optional PostgreSQL пропущены. Web:429 успешных. Ops:22 успешных. Phone:7 успешных.
- Реальный isolated Docker smoke прошёл: пустой production, повтор миграций, Web/API proxy, auth/Origin/Secure cookie, non-root/read-only runtime, ML worker, backup и восстановление в новую PostgreSQL БД, SIGTERM и перезапуск с сохранением данных. Временные volumes удалены только для уникального test project. Штатный SIGTERM Next может давать143; новый случайный hostport определяется после restart.
- Первоначальный API запуск тестов без sandbox-разрешения loopback заменён полным успешным прогоном с concurrency2. В CI также ограничена параллельность API-тестов.
- Реальная WMS продолжает прежнюю работу; её остатки, документы, сотрудники и настройки не менялись. Production данные/ключи не использовались в контейнерах. Push, registry publish, SSH, DNS и Artmate config не выполнялись.

## Следующее после выбора площадки

Проверить ресурсы хоста и имя домена, настроить registry/environment, выбрать immutable release images, пробно перенести полный dump с исходным ключом, согласовать окно переключения, остановить прежний importer, финально перенести БД, подключить HTTPS и пройти реальный складской сценарий. Подробный порядок: docs/DEPLOYMENT.md и docs/RELEASE_OPERATIONS.md.

- На финальном review устранена DNS-коллизия api в общей сети Artmate: у WMS уникальный private alias и compile-time proxy; проверка второй сети с чужим api прошла, включая фактический Web/API маршрут и восстановление. Тестовый чужой API имеет явный healthcheck, чтобы Compose --wait проверял его готовность.

- Production runtime сохранён локальным коммитом 01a21d8. Инфраструктурные файлы готовы к отдельному коммиту; работающая локальная WMS не перезапускалась.

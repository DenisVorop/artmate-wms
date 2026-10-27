# Проверенные исходные факты

- WMS пока имеет только dev PostgreSQL Compose; API main включает планировщики после listen: docker-compose.yml; apps/api/src/main.ts.
- Текущая инициализация автоматически создаёт demo: apps/api/src/warehouse.service.ts:184. Ключ по умолчанию создаётся lazy в .data: apps/api/src/marketplaces/secrets.ts:21–58. При переносе необходим прежний 32-байтовый ключ, а не новый.
- Next rewrites фиксируют API_INTERNAL_URL при build: apps/web/next.config.ts. Export Swagger использует memory DB и не запускает планировщики: apps/api/src/export-openapi.ts.
- Artmate использует Caddy на 80/443 и project artmate; общий Permissions-Policy блокирует камеру. Reference: artmate-monorepo/docker-compose.prod.yml:313–346; infra/caddy/Caddyfile:5–15. WMS нужна отдельная политика camera=(self).
- Reference допускает отдельный проект во внешней сети artmate_default: artmate-monorepo/infra/telegram-relay/docker-compose.yml:1–25. В подключение пойдёт только Web, не БД.
- Docker daemon локально доступен через разрешённый запуск команды:27.3.1/aarch64; Compose2.29.7. Текущий склад остаётся запущенным на3080/4080/5440, проверки контейнеров используют другие изолированные порты и данные.

- Финальная проверка: reference Artmate имеет свой service api (docker-compose.prod.yml:32), поэтому WMS получает уникальный private alias artmate-wms-api-internal. Smoke добавляет вторую сеть с чужим alias api, проверяет baked rewrite и фактическую маршрутизацию.

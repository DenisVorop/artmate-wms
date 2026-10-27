# Проверенные причины

- planning.ts делает dataComplete=false при failed/manual running, возрасте >24ч и отсутствии вчерашнего дня, хотя snapshots сохраняются.
- forecast-storage.ts:readForecastPlanContext обнуляет goals при изменении input key до публикации worker.
- marketplace.service.ts:connect оставляет snapshot при ротации ключа. Для fallback обязателен lastSuccessVersion===version.
- 27 октября утром Ozon обновился, WB повторно завершал импорт по общему таймауту. Последний полный WB snapshot заканчивался 25 октября. Конкретная операция таймаута не установлена; недопустимо менять coverage или считать пропущенный день нулём.

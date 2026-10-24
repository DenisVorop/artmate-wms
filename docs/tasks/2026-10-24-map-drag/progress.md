# Прогресс

## Реализовано
Space:* в общем drag pipeline, preview пола/стен/привязанных входов, инструмент «Двигать объекты» и подсказки. Cancel Escape/pointercancel/lostcapture/режим, pending guards; точные координаты через формы. ADR028.

## Проверено
На отдельной artmate_wms_map_drag_preview браузером выполнено6сохранённых drag: room x10→11, floorY3→4, rackX14→15 со всеми ярусами, aisleX16→17, entranceoffset2→3, corridorX10→9. Нет изменений ID/QR/лимитов/баланса. Отклонение пересечения полностью откатило геометрию без revisionchange. Найден и исправлен edgecase: Y7.52 при горизонтальном drag сохраняется, округляется DELTA. Overviewdrag/pan/keyboardselect/modalcancel сделали0записей. Scoped8/8 pluspointertests, typecheck агента успешны. Браузерная проверка в dev preview; финальный production build и audit далее.

## Завершено
Backup и guarded sync выполнены. Все обязательные проверки успешны, web133/133. Основная версия запущена; audit подтвердил все поля/план/команды, revision26. Реальная карта открыта в конструкторе, координаты совпадают с backup, screenshot сохранён. Тестовые services остановлены. Без seed/reset основной базы.

# Контракт конструктора (этап 3)

## Результат

Прямоугольное помещение с заданными шириной/глубиной в метрах; стены и реальные входы на сторонах помещения; прямоугольные коридоры; стеллажи и напольные места, выбор/перетаскивание/поворот, параметры и удаление с восстановлением. Сохраняются прежние адреса и QR. Это редактирование схемы, не складское перемещение паллет.

## UX и границы

- Текущий тёмный glass-стиль и FSD. Два режима: обзор и конструктор. В конструкторе видимая панель добавления «Секция», «Место», «Проход», «Вход», «Размеры склада», «Корзина». Добавление через формы с предлагаемой свободной позицией; объекты перетаскиваются на плане.
- Все жесты имеют числовую альтернативу в параметрах; поворот кнопкой90° и полем0/90/180/270. `rule/gesture-has-control-alternative`.
- Удаление означает убрать с плана в постоянную корзину. Можно восстановить позже; не нужна лишняя модальная проверка. Непустое место/резерв удалить нельзя; причина видна рядом. `rule/destructive-proportional`, `rule/undo-only-when-honest`, `rule/name-object-scope-consequence`.
- Ошибки оставляют значения формы; неуспешный drag возвращает предыдущую геометрию и показывает сообщение. Pending блокирует новые записи. `rule/preserve-user-input`, `rule/error-states-recovery`, `rule/cover-reachable-states`.
- Клавиатура, доступные названия инструментов, видимый focus. `rule/accessible-name-required`, `rule/keyboard-complete-flow`.

## API — канонический контракт

NestDTO/Swagger → Orval, без общего пакета контрактов. Все команды принимают requestId, возвращают WorkspaceDto. Мутации — существующий стиль POST.

WorkspaceDto дополнен:
- warehouse: WarehousePlanDto { name:string, width:number, depth:number }
- aisles: AisleDto[]
- entrances: EntranceDto[]

Новые поля Section/Location:
- rotation:number (0,90,180,270), archived:boolean, archivedAt:string|null.
- Только RackSectionDto: archivedLocationIds:string[] (групповое восстановление только ярусов, активных при удалении секции).
- Все прежние поля сохраняются. Архивные entities остаются в snapshot для истории; оперативные списки/карта используют !archived.

AisleDto {id,name,x,y,width,depth,rotation,archived,archivedAt}. Проход не является адресом хранения, не получает остатки/QR. Пересечение проходов разрешено для Т-образных и перекрёстных проходов.
EntranceDto {id,name,wall,offset,width,archived,archivedAt}. wall:north|east|south|west. offset — расстояние от левого края для north/south, от верхнего для east/west; width — ширина проёма. Вход привязан к стене, не к произвольной точке. Рисовать разрыв/проём и стрелку; drag выбирает ближайшую стену и ограничивает offset.

Новые DTO/operationId:
- UpdateWarehousePlanDto {requestId,name?,width?,depth?} → updateWarehousePlan(dto)
- CreateAisleDto {requestId,name,x,y,width,depth,rotation?} → createAisle(dto)
- UpdateAisleDto {requestId,name?,x?,y?,width?,depth?,rotation?} → updateAisle(id,dto)
- CreateEntranceDto {requestId,name,wall,offset,width} → createEntrance(dto)
- UpdateEntranceDto {requestId,name?,wall?,offset?,width?} → updateEntrance(id,dto)
- deleteLocation(id,CommandDto),restoreLocation(id,CommandDto)
- deleteRackSection(id,CommandDto),restoreRackSection(id,CommandDto)
- deleteAisle(id,CommandDto),restoreAisle(id,CommandDto)
- deleteEntrance(id,CommandDto),restoreEntrance(id,CommandDto)
- Existing CreateLocationDto/CreateRackSectionDto/UpdateLocationDto/UpdateRackSectionDto get optional rotation. Response rotation always defined.

Обычные nullable поля не добавляются; optional не означает null. Удаление/восстановление — идемпотентно по requestId, не удаляет историю. Архивный код нельзя повторно выдать новому адресу.

## Геометрия и проверки

- x/y — верхний левый угол внешнего bounding box; width/depth — исходные размеры объекта. Rotation90/270 меняет width/depth местами для bounds/collisions, rotation180 отличается стрелкой ориентации. При повороте x/y остаются прежними. Адреса ярусов зеркалят все5 геометрических полей секции; их физические ограничения в мм не поворачиваются.
- Помещение width/depth1..1000; геометрия конечна, координаты>=0; размеры секции/места>=1м, прохода>=0.5м; входwidth>=0.5м. Прилегание по границе допустимо, пересечение площади нет.
- Активные секции/standalone адреса не пересекаются друг с другом и с проходами. Проходы пересекаются друг с другом. Стеллажи внутри одной секции — один footprint.
- Вход лежит на стене целиком; входы на одной стене не перекрываются. Глубина зоны свободного доступа и маршрутизация техники пока не моделируются: вход — обозначение проёма, не адрес.
- Уменьшение помещения запрещено, если активный объект или вход выходит за границы. Входы на east/south переезжают вместе со стеной; offset/width сохраняются.
- Новая/изменённая геометрия/восстановление проверяются сервером в одной транзакции. Миграция не переставляет физический склад. Если legacyпересечения есть, не ломать все складские операции глобальной проверкой: проверять геометрическую команду и показать старые конфликты отдельно при необходимости.

## Удаление и восстановление

Удалять адрес/секцию нельзя при:
- физической stored паллете (включая quantity0), storedкоробах;
- returnLocationId активной паллеты;
- planned/in_transit движении, где адрес — source ИЛИ target.

Завершённая история не запрещает удалить с плана. Архив не участвует в авторазмещении, сборке/перемещении/подготовке отгрузки; backend также отклоняет прямую команду на архивный адрес. getLabel не теряет QR, но явно помечает название как архивное.

Удаление секции архивирует её активные адреса и запоминает ихIDs в archivedLocationIds. Восстановление возвращает только их, не ранее отдельно удалённые ярусы. Архивный отдельный ярус при архивной секции нельзя восстановить отдельно — сначала секцию. Архивирование последнего яруса допустимо; секция остаётся с действием «Добавить ярус».

Восстановление проверяет текущие bounds/пересечения. При конфликте остаётся в корзине, показывает причину; пользователь может освободить место или увеличить помещение, затем повторить.

## Миграция и совместимость

Schema_version3, additive. warehouse хранить в metadata; aisles/entrances — новые JSONdocumenttables. Поля архив/rotation добавляются defaultsfalse/null/0. Первый размер помещения = ceil(max(24, rightmost+2)),ceil(max(16,bottommost+2)), учитывая текущий план; это редактируемая демогеометрия. Входы/проходы первоначально пустые — реальные неизвестны. Сохранить все IDs/коды/остатки/историю; backup перед основной миграцией.

Кэш web принимает текущий snapshot только с warehouse/aisles/entrances, прежние командные ответы остаются допустимыми legacyответами, но не перезаписывают свежий snapshot. Sourceoftruth — PostgreSQL.

## Владение UI файлами

Mapagent: warehouse-layout.tsx, warehouse-layout.module.css, map-view-model.ts/test, use-map-interaction.ts, новые canvas/геометрия presentationфайлы. Formsagent: остальные файлы warehouse-layout, включая model/use-location-actions и lib/use-layout-state, новые формы/панели/корзина. Root: shared commands/shape, все прочиеfeatures, документация и интеграция.

Map/forms агенты должны согласовать Props новых компонентов сообщением напрямую до реализации integration. Backend публикует DTO/OpenAPI первым. Не редактировать generated SDK вручную.

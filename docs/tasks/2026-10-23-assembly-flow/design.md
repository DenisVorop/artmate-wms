# Дизайн и контракт — свободная очередь и сборка

## Смысл

Руководитель создаёт задание на N коробов одного SKU; единиц в коробе берётся из тематики. Сотрудник на смене выбирается в текущем административном экране как demo-исполнитель (реальная авторизация/телефон позднее). Может взять свободное задание без предварительного назначения. Руководитель может назначить/снять/изменить назначение из карточки после создания.

Внутри задания каждый короб — отдельный рабочий цикл. После закрытия N-го короба задание завершается и сотруднику автоматически берётся следующее доступное задание. Сначала ожидающие, заранее назначенные ему; затем свободная очередь. Если очереди нет, явное завершение. Никогда не забирать чужое или поставленное на паузу задание автоматически.

Две упаковки по10 — физическая подготовка20 раскрасок. На этом этапе нет складского списания и отдельного учёта пачек. Для unitsPerBox20 показывать подсказку «Подготовьте2 упаковки по10»; иначе общий текст N единиц. Печать индивидуальных товарных этикеток не добавляется: используется штрихкод тематики из приёмки. Списание каждой единицы происходит по её скану.

## API — источник Nest/OpenAPI

Schema6 additive TaskDto fields:
- `createdAt: string | null` (новые задания ISO now, старые null; не выдумывать историческое время).
- `boxCodeConfirmed: boolean` (миграция: старые с scannedUnits>0=true, прочие=false).
Все старые IDs/stock/QR/receipts/geometries/commandresponses/revision сохраняются. Seeded пустой склад остаётся пустым. Legacy responses не переписываются; web guard не позволяет v5 taskshape стереть подтверждение короба.

Новые команды возвращают WorkspaceDto:
- POST `/api/tasks/:id/claim`, operationId `claimTask`, `ClaimTaskDto extends CommandDto {employeeId:string}`. Только working employee; task queued или paused assigned to himself (unassigned paused недопустимо); unassigned queued или assigned same actor. Чужое назначение/active/completed/другое active того же сотрудника отклонить. Актуальность источников и адресов проверить как start. Атомарно employeeId=actor,status=active, activity. Два клиента за одним task: ровно один успешный. Повтор requestId не повторяет захват.
- POST `/api/tasks/:id/assignment`, operationId `assignTask`, `AssignTaskDto extends CommandDto {employeeId:string|null}`. Admin command demo; queued или paused только, completed/active запрещены (сначала пауза). Менять исполнителя можно между коробами: scannedUnits=0 И boxCodeConfirmed=false. При нарушении понятная причина, никакого потери текущего открытого короба. employee must exist, может быть off. При изменении очищать sourcePalletId, boxCodeConfirmed=false; unassign sets queued. То же назначение может быть допустимым no-op, но не обходом active. Резервы/количества/QR не меняются.

Существующие:
- `ScanTaskDto` добавить required `employeeId:string`, enum kind `source|box|barcode`; owner exact + working + task active на каждую команду. source подтверждает только следующую зарезервированную паллету FIFO; box подтверждает текущий openBoxCode или `artmate-wms:box:<code>`, только после source и до любых сканов товара. Повтор другим requestId того же текущего правильного кода допустим; чужой/старый код отклонить. barcode требует boxCodeConfirmed=true и текущий FIFO source.
- `PackTaskDto` добавить required employeeId; проверять owner, boxCodeConfirmed и текущий code/fullness. Нужен для восстановления мигрированного полного короба; обычный путь без кнопки.
- `UpdateTaskStatusDto` при start/paused требует actor employeeId, не должен незаметно переназначать. `active` идёт через ту же логику claim: legacy bypass не оставлять. Paused только текущим working actor; текущий shift/off продолжает автоматическую паузу как раньше.
- `CreateTaskDto` прежний. Без employee допустим; все резервы по FIFO уже на создании. При назначении во время create employee может быть off (планирование), start потребует working.

### Автоматическое закрытие

Последний barcode scan атомарно переносит последнюю единицу в НЗП, закрывает полный короб, создаёт готовый запас, считает результат, сбрасывает текущий цикл и при необходимости берёт следующее queued задание. Вызвать общий приватный helper из scanTask/packTask, не делать зависимость от client useEffect/двух случайных POST.

Закрытие только в активную подходящую зону `assembly` (пользователь: общий паллет на месте сборки). Дополнять подходящий по SKU/профилю паллет, пока хватает вместимости. Иначе создать следующий паллет на свободном подходящем адресе assembly. Не отправлять автоматически готовый короб на rack/floor. Если места нет, последний scan целиком откатывается, сохраняется N-1 и остаток источника; UI объясняет, что нужно освободить/создать место сборки. Пакет не исчезает и баланс сохраняется.

В коробе lotContents snapshots, packedAt, unique code, profile, palletId; одна паллета — один SKU. Полный balance сохраняется raw→WIP→boxed. Повтор последнего scan возвращает прежний response, не создаёт ещё короб и не сканирует единицу уже следующего задания.

После обычного закрытия task.boxesCompleted++, reset scannedUnits/openContents/boxCodeConfirmed=false, новый openBoxCode; sourcePalletId всегда сбрасывается в null: каждый новый короб начинается с подтверждения физической паллеты, даже если источник прежний. Автоследующее задание: queued candidates assigned actor first, then unassigned by (createdAt??'',id); пропускать недоступные источники/активные moves/архивные/blocked адреса без отката уже собранного короба. Не брать paused. Новый task active needs fresh source and box scan. Если очереди нет — сотрудник свободен.

Этикетка уже поддерживается GET `/api/labels/box/:code` и для открытого короба, и после упаковки. Код постоянен; перепечатка не меняет его. Новый endpoint не нужен. На labels page обязательно безопасный img SVG + loaded gate + print100×70mm; реальные принтеры не тестируем.

## UI — FSD

Assembly feature разбить на управленческую очередь и рабочую панель; CSS modules в текущем стеклянном/mint стиле. UI-state вlib, server mutations вmodel, RHF/Zod для форм и сканов, helpers/tests. Publicindex прежний. Не модифицировать generated вручную.

- Верх: create, metrics; tabs «Свободные», «Назначенные», «В работе», «Завершённые» (включая paused в соответствующий именованный фильтр), поиск если нужен; активная карточка с progress/assignee.
- «Работаем как» dynamic employee chooser — видимый demo actor, не авторизация. Рабочий actor обязателен для take/start/scan/pause. Это не меняет назначение других карточек.
- Свободный task имеет «Взять задание» для actor working. Выбор карточки только просмотр, не захват.
- Назначение после создания inline на карточке: employee select including null/unassign, save. Disabled explanation active/partial box, ссылка паузы/закончить короб. Не nestedmodal.
- Рабочие шаги: active current owner→источник, затем подготовка и ссылка печати текущего короба, затем пустое поле скана коробки, затем пустое поле скана каждой единицы и крупный счётчик. Скан source через ввод QR/читаемого кода; убрать кнопку с автоматически подставленным кодом. Ручной режим barcode для проверки можно оставить, но только ПОСЛЕ успешного подтверждения коробки, явно меняет данные.
- Каждый input+Enter выполняет текущий этап, ошибки сохраняют ввод. Последний scan auto close и UI выбирает active task этого сотрудника из свежего Workspace. После очередного короба того же задания показывает новый код/обязательный box scan. После lastjob если взят следующий — явный notice с обоими task codes и переход; очередь пуста — явное завершение. Не скрывать ошибку обновления GET и не потерять committed success на refresh failure.
- Старый полный migrated box: отдельная recovery-кнопка закрытия, actor/boxCode checks; после нормальных сканов кнопка не требуется.
- Empty/loading/error/partial/full/noassembly/noactor/offshift/claimedelsewhere/inputpreservation/replay states covered. Правила product-design: rule/cover-reachable-states, rule/preserve-user-input, rule/no-nested-modals, rule/one-primary-action, rule/name-object-scope-consequence, rule/accessible-name-required.

## Владение

Backend agent: apps/api/**, openapi, ADR022. Assembly UI agent: features/assembly/**, ADR023. Labels agent: features/labels/**, необходимые stylesheet только для labels, ADR024; независимое read-only review backend afterwards. Root: shared SDK wrappers/shape/cache tests, typed fixtures, docs/AGENTS, integration/deployment/audit/verification/browser. Не создавать мобильную отдельную версию сейчас.

## Проверка

Новая изолированная PostgreSQL *_test, preview другая копия main. Не менять main до финального переноса. Tests: claim race, owner, safe reassignment, wrong/missing box scan, oldcode reuse, automatic final scan preserves balance/replays, sameSKU assembly-only capacity, legacy restart, auto next prioritization/skips/endempty, oldflows no regression. UI fullflow unassigned create→take→source→print→boxscan→20units→FG+auto next; administrative reassignment and busy rejection. Actualmain backup/audit all14entitycollections+metadata+commands oldfields preserved.

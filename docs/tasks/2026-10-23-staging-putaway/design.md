# Контракт — общая паллета накопления → хранение по тематикам

## Исправление бизнес-правила

Пользователь прямо уточнил: на сборке один общий физический накопитель для всех тематик. Это не паллета хранения. Raw и finished storage остаются строго1SKU. В системе необходимо отдельное различие, без фиктивного SKU «смешанный».

После закрытия короба он автоматически добавляется на общую паллетуassembly и появляется queued второстепенное задание на размещение ЭТОГО короба. Сотрудник берёт по желанию; первичная очередь никогда автоматически не запускает второстепенное. Второстепенный MVP — один короб на задание, не групповая перевозка россыпи. Баланс не меняется, только физическая доступность и адрес.

## API/schema7

`PalletDto.kind`: raw|finished|assembly. `skuId:string|null`, null разрешён ТОЛЬКО для assembly, там всегдаnull. Assembly pallet packagingSnapshot — фиксированный базовый профиль физического поддона из первого короба, не «одинSKU». Каждый box сохраняет собственный sku/profile/lotContents. Existingraw/finishedfields/IDs/QR/stock/history/revision/commandresponses сохранить без переписывания; старые паллеты в зонеassembly не конвертировать/не объединять виртуально.

`BoxDto.status`: stored|in_transit|shipped. In_transit в размещении: palletId=null,locationId=null, короб у сотрудника, единицы остаютсявbalance. Rawbalance прежний; boxedUnits и perSKUучёт включают stored+in_transit. Shipping не использует in_transit или накопительassembly/незавершённое размещение.

Новая таблица `putawayTasks` и обязательный `WorkspaceDto.putawayTasks:PutawayTaskDto[]`:
{id,code,boxId,skuId,status:queued|claimed|in_transit|completed,employeeId:string|null,fromPalletId:string,fromLocationId:string,toLocationId:string|null,createdAt:string,claimedAt:string|null,takenAt:string|null,completedAt:string|null}.
У каждого коробa максимум1незавершённое задание. Sourcefields исторические; qty1box. На pack создавать задание в той же транзакции. schema7 создаёт queued для прежних stored boxes на assembly с stored pallet без активного паллетного движения; фактический createdAt=packedAt. Никакого повторного seed. Версия/перезапуск идемпотентны.

Новые operationId, все команды возвращают WorkspaceDto:
- GET `/api/putaway-tasks/:id/placement-options` getPutawayPlacementOptions → {boxId,locations:LocationDto[],suggestedLocationId:string|null,reason:string|null}. Только rack/floor; сначала совместимая finished-паллета того жеSKU и профиля, затем свободный адрес. Высота/геометрия/масса/quantitymaxBoxes/active movement+returnhold и входящие putaway-резервы учитываются. Не пишет.
- POST `/api/putaway-tasks/:id/claim` claimPutawayTask `{requestId,employeeId}`. Толькоqueued, actorworking, без active primary assembly task, без active pallet movement и другойclaimed/in_transitputaway. Сервер выбирает подходящий target как options, резервирует его черезtask.toLocationId, setsclaimed/employee/claimedAt. Нетtarget→rejectбеззахвата, packвassemblyотэтогонезависим. Атомарность/гонки:2сотрудникаодинtaskровно1успех; разныеSKU не резервируютодинпустойtarget; sameSKUсовместимые могутзарезервироватьвместимостьсучётомобщегоперспективногочислакоробов.
- POST `/api/putaway-tasks/:id/take` takePutawayTask `{requestId,employeeId,boxCode,locationCode}`. Owner+working, claimed, QR/current readablecode box и current fromLocation. Sourcebox stored, нужныйsourcepallet, активныйaddressassembly, no conflictingmovement. Decrement sourcepalquantity/recompute dimensions, box→in_transit/nullpal/nulladdress, task→in_transit/takenAt. Пустой assemblypodдон остаётся занятым на адресе. Текущийbalanceне меняется.
- POST `/api/putaway-tasks/:id/place` placePutawayTask `{requestId,employeeId,boxCode,locationCode}`. Owner+working,in_transit, scanbox и зарезервированногоtoLocationId. Revalidate target+otherreservations, create thematic finished pallet сboxprofile еслиtargetempty, иначе добавитьвсовместимыйfinished. Box→stored/pallet/target, taskcompleted/completedAt; reservationsзавершены. Размещение2timesreject, samekeyreplayбезповтора.
- POST `/api/putaway-tasks/:id/release` releasePutawayTask `{requestId,employeeId}`. Ownerworking, толькоclaimed, очищаетtarget/actor/times→queued. Еслиужеin_transit нельзяброситькороб: сначалаplace. UI явнопишетограничение.

Primary _claimTask и pallet createMovement блокировать для actor с активнымputaway; _takeNextTask не стартуетprimaryкогдаактивенputaway. При user shift off/break: in_transitputaway запрещает завершитьсмену (сначалапоставитькороб); claimedбеззабора можно автоматическиосвободитьвqueue иснятьtargetreservation. Локальныйdemoactor не являетсянастоящейauth.

## Накопитель и физика

В _packTask сначала существующая активная stored assembly-паллета (независимоSKU) в местеassembly. Еслисуществующийнакопительполон — ошибкапоследнегоscan, нужнаразгрузкачерезputaway. Не создаватьещёпаллетыпотематикам или вторуюпараллельноиз-запереполнения. Еслинакопителяещёнет — создать1на свободномподходящемassemblyaddress; raw/legacyfinishedнаадресе учитываютсякакфизическаязанятость.

Консервативные mixed-габариты из фиксированногоBASEпрофиляподдона и snapshotsкоробов: максимумwidth/depth/heightкороба дляединойсетки, bpl=min(заявленныеbplкоробов, вместимостьмаксfootprintнаBASEподдоне сrotation), maxLayers=min(ограниченийprofiles). height=baseheight+ceil(count/bpl)*maxBoxHeight; totalweight=BASEpalletweight+sum(boxweight), unknownеслиестьunknown. Boxes mustfitbase, nofalsezero/capacity. maxBoxes адреса учитываетсядляassemblyтакже. Пустойподдонсохраняетbasewidth/depth/height/weight, ID, адрес. Его можнодополнять новымиSKU. Boxqty — числоstoredboxesнаподдоне. Snapshotкаждогокоробанеизменен. Helper вphysical.ts сmeaningfultests.

Assemblyпаллета не может целикомпереехатьна rack/floor/picking/shipping обычнымпаллетнымmovement. Сообщение«Разместите короба по тематическим паллетам через второстепенные задания». Пустойподдонможновывести существующейretireкомандой. Sourceassemblyможетполучатьновыекоробапокаоттудазабирают отдельные; транзакциисериализованы.

## Резервы и безопасность адресов

АктивныеputawaytoLocationId учитываются при любом placement (receiving/palletmovement/newpackstorage), проверках удаления/архива/уменьшения/блокировки адреса и перемещении/retiretargetpallet. Резервможетбытьнецелыйсвободныйадрес, аещё1коробнасовместимомtarget. Нельзяиспользоватьего дляинойSKU/профиля. Дляputawayplace игнорироватьсвойreservation иучитыватьостальные. Вариантhelper/сервисоставленbackendагентуприусловииполныхинвариантов и meaningfultests; не дублироватьихвоfrontend.

На _boxFifo/созданииshipment исключить box вassembly-паллете, наassemblyадресе, сnotcompletedputaway илиin_transit. Послеputawaycompleted онобычныйstored readyreserve FIFOпоlotдатам. Дальнейшиеспуск/отгрузка/wholepalletmovement finished прежние. Closing/putaway неувеличиваетtotal второйраз.

getLabel(pallet,id) дляassembly title«Общая паллета сборки», QRстабилен. Legacyfinishedвassembly можетбытьисточникоммиграционногоputaway; приtake пересчитатьoldfinishedобычнымprofile, приtakeemptystillphysical. ПослеplaceMovement legacyfinishedвassembly создатьmissingputawayдлякоробов, еслинужно, безпереписыванияcompletedистории.

## UI/FSD

Новый slice features/putaway + _pages/putaway-page + thin /putaway route, shellnav «Размещение коробов» (второстепенные задания). Компоненты текущийglass/mint, RHFZod, model→sharedcommands, ui-stateвlib. Очередь queued/моиactive/completed, actorworkingchooserdemo. На карточкеboxcode/SKU/frompallet/fromaddress, suggestedtarget, «Взять размещение» добровольно. Еслиactiveprimary — объяснениепаузы и ссылкакСборке. Нетtarget→причина/карта, nofalseclaim.

claimed→двапустыхскана box/fromaddress + «Забрать короб». Показыватьзарезервированныйtarget. Release доtake. in_transit→сканытого жеbox/targetaddress + «Разместить короб». Никакойавтоподстановкисканов; Entersequence, ошибкасохраняетввод. Послеplace готовыйисторическийtaskвcompleted, очередьследующегопользовательберётсам (опциональныйсценарий). Повторнаяпечатьboxlabelпрежняяroute. Empty/loading/error/pollpreservation/reservationconflict/ownership/shift/noaddress coverage, no nestedmodal.

AssemblyUI copy: готовыйкоробидётв«общуюнакопительнуюпаллету», themesmixedallowed, не обещатьготовокотгрузке; заметнаяссылка воsecondaryputaway. Послеpack автоnextPRIMARYсохраняетсякакэтап7. Secondaryvoluntaryпользовательделаетпослепаузыprimaryиликонцаqueue.

Integration все reading surfaces:
- Inventory pallet nullableSKU/assembly показать«Общая паллета сборки», составтемпоstoredboxпаллете; filteringпоSKUдолженнаходит mixed черезboxrefs. perSKUboxedUnits stored+in_transit, общийbalance ссерверa; boxstage подпись«На накоплении»/«В размещении»/«На хранении»/«Отгружен». Intransitнеисчезаетизbalance.
- Map locationdetails/summary mixednames+состав, количествоboxes/palletsнепотерятьassembly. ЦветнефальшSKU. QRlinksпрежние.
- Movementcreate не предлагаетassemblyдляперевозкицеликом; существующийdetailslegacyreadable. Retireemptyassemblyдопустим.
- ShipmentavailabilityUI соответствуетserverexcludeunstoredassembly/tasks; readiness afterputaway normal. Dashboard mixedpallet не выдаёткак1случайныйSKU, perthemeFGизbox.

Root sharedSDK wrappers fivecommands, WorkspaceguardrequiredputawayTasks; fixtures4workspaceemptyadd[]. Legacyresponsesзащищены. Домен/APIвNest, Orvalgeneratedтолькоинструментом.

## Владение

Backend: apps/api/**,openapi,ADR025. SecondaryUI: features/putaway, features/assembly copy/link, _pages+routeputaway, shellnav/breadcrumb,ADR026. Integration: inventory/dashboard/map/movements/shipments surfacecompatibility+tests,ADR027. Root sharedSDK/cacheguards/fixtures/docs/AGENTS/verifydeploy. Все /private/tmp/artmate-wms-staging-putaway. Никтоне меняетactual/main.

## Проверка

Новые изолированные *_testиpreviewDB, неmain. Regressionmixed2themes→1assemblypal→queued2putaways→twoemployeesclaim/races/targetcapacity→takebalancepreserved→placeseparateSKUfinished→shippingready. Negativewrongbox/address/owner/replay/noaddress/nocapacity/blocked/deletecell/shiftwhilecarrying/wholeassemblymovement, basefootprintvariedprofile conservative, emptyassemblyreuse/retire, schema7/restart/legacyIDs/cache preserved. Actual backup/guardsource sync/fulltypeslinttestsbuild, compareall14oldcollectionsfields+metadata+commands, browserrealactions.

Product-design rules: rule/name-object-scope-consequence, rule/cover-reachable-states, rule/preserve-user-input, rule/no-nested-modals, rule/one-primary-action. Пользовательскоеисключениеassembly явноисправляетпредыдущиеADR, невыдумыватьобратноеограничение.

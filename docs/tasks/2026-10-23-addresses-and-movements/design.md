# Контракт этапа 2

## Адреса

WorkspaceDto получает sections: RackSectionDto[] и movements: MovementDto[]. RackSectionDto: id,code,name,x,y,width,depth. LocationDto остаётся конечным адресом, получает sectionId:string|null,level:number,availableWidthMm,availableDepthMm,maxWeightKg:number|null,accessSides:number. Для стеллажа каждый ярус — отдельная Location, ровно одно паллетоместо; для пола sectionId=null,level=1. x/y/width/depth у rack Location отражают геометрию секции и синхронизируются сервером, UI рисует секцию один раз. Старые Location.id/QR сохраняются как адрес первого яруса.

Новые DTO: CreateRackSectionDto {requestId,code,name,x,y,width,depth,levels:[{code,name,maxHeightMm,maxBoxes,availableWidthMm,availableDepthMm,maxWeightKg?,accessSides?}]} -> создать секцию и реальные адреса. UpdateRackSectionDto {requestId,code?,name?,x?,y?,width?,depth?}. Обновление ограничений каждого адреса отдельно updateLocation. Добавление яруса CreateRackLevelDto {requestId,code,name,maxHeightMm,maxBoxes,availableWidthMm,availableDepthMm,maxWeightKg?,accessSides?}; level сервер назначает следующий. createLocation только floor/receiving/assembly/shipping/picking; rack через section API. Архивирование ярусов пока не нужно, удаление занятого не вводить.

## Габариты

PalletDto: widthMm,depthMm,weightKg:number|null,status:stored|in_transit|retired,locationId:string|null,returnLocationId:string|null. Пустая физически стоящая паллета занимает адрес, пока retireEmptyPallet не подтверждает вывоз; нулевой товарный остаток не освобождает место автоматически.

CreateReceiptDto дополняется widthMm,depthMm,weightKg?. Старые данные мигрируют с демонстрационными1200×800мм и явно записанной версией миграции. Проверка размещения: ширина/глубина (разрешён поворот90), высота, известная масса при наличии обязательного лимита места. Если у места есть maxWeightKg, а масса паллеты неизвестна, отказ. Профиль SKU: packaging {boxWidthMm,boxDepthMm,boxHeightMm,palletWidthMm,palletDepthMm,palletBaseHeightMm,boxesPerLayer,maxLayers,boxWeightKg:number|null,palletWeightKg:number|null}. UpdateSkuPackagingDto обновляет профиль, проверяет существующие паллеты/запас; упаковка закрытого короба должна сохранять профиль или габаритный снимок, чтобы изменение не изменяло прошлое. Готовая высота = base + ceil(boxes/boxesPerLayer)*boxHeight. Профиль редактируемый; проверять умещение заявленного слоя, не выводить вместимость из одного отношения площадей.

## Перемещения

MovementDto: id,code,palletId,fromLocationId,toLocationId,kind:transfer|lower|return,status:planned|in_transit|completed|cancelled,employeeId,keepSourceReserved,createdAt,takenAt:string|null,completedAt:string|null.

CreateMovementDto {requestId,palletId,toLocationId,kind,employeeId,keepSourceReserved?:boolean}. takeMovement(id,{requestId,palletCode,locationCode}) проверяет код паллеты и источник; placeMovement(id,{requestId,palletCode,locationCode}) проверяет цель. cancelMovement только planned. При taken паллета locationId=null,status=in_transit, все короба наследуют transit (box.locationId nullable). На completed обновить паллету и дочерние stored-короба атомарно, количество/партии не меняются.

План резервирует цель, активное перемещение одно на паллету. При lower требуется целевой picking с accessSides=4. При take lower keepSourceReserved удерживает исходный адрес через pallet.returnLocationId до возврата. При return можно занять свой резерв; по completed снять резерв. Сторонняя приёмка/перемещение/уменьшение адреса не использует резерв цели или возврата. При taken несовместимый источник в сборке недоступен. Перемещение raw с активными резервами заданий отклонять. retireEmptyPallet подтверждает физический вывоз пустой паллеты, снимает адрес и удержанный возврат; только quantity0 без stored коробов.

Отгрузка резервирует конкретные короба независимо от перемещений. Перед shipShipment все короба должны быть в picking/shipping и не in_transit. UI предлагает спуск нужных паллет и переход в Перемещения; после take+place разрешается отправка. Частичный отбор оставляет остаток той же паллеты, затем return. Старые completed отгрузки не менять.

## Надёжность

Все команды requestId и pg transaction/advisory lock. Миграция additive/idempotent с version metadata, без очистки существующих данных. Не переиздавать ID и QR существующих адресов/паллет/коробов. Исторический ответ идемпотентности может иметь старую схему, поэтому frontend после успешной команды перечитывает свежий snapshot, а не доверяет старому ответу как текущему состоянию.

## API operationId

getWorkspace,createLocation,updateLocation,createReceipt,createTask,scanTask,packTask,updateTaskStatus,createShipment,shipShipment,updateEmployeeShift,getLabel сохраняются. Добавить createRackSection,updateRackSection,createRackLevel,updateSkuPackaging,createMovement,takeMovement,placeMovement,cancelMovement,retireEmptyPallet. Новые endpoint DTO — источник Orval.

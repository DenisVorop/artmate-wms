# Прогресс

## Сейчас
Скопирован актуальный проект в отдельный staging. Основные сервисы3080/4080 не меняются до проверок. Контракт фиксируется перед параллельной реализацией.

## Дальше
Backend DTO/OpenAPI→Orval→интерфейс, затем проверки на новой PostgreSQL-копии и guarded sync с backup.

- Зафиксирован контракт schema6, actor ownership, claim/assign и автоматическое закрытие на последнем scan. BackendDTO/OpenAPI экспортированы, Orval generated; rootshared wrappers и taskshape guard готовы,17cachetestsPASS.
- Реализация делегирована: backend/assemblyUI/labels с непересекающимся владением; root интегрирует cache/docs/deploy и браузер.
- Создана новая artmate_wms_assembly_preview копия main; сервис ещё не запущен до corefreezebackend. Actual/main пока не менялись.

- Preview UI прошёл firstflow: свободное задание2короба создано; назначениеИвану→Anna takeblocked→unassign→Anna selfclaim. Sourceиboxscanпустые; неправильныйкодкороба/штрихкодтовара отклоненывводсохранён; pauseс1/20сохранилаWIPиblockedassignment. Resume+20-йscan автоматическидал1коробвassembly, balance100=raw80+boxed20, новыйsource=null/boxCodeConfirmed=false. Старыйlabelcodeсохранился.
- UIreviewисправлен: optionalназначениеприcreationсохранено, подготовка/маркировкапоuser, copyбезgenderguess. Web107/107+FSD131 PASS. Finalpreviewbuildидёт; далее2-йкороб+autonext+конецочереди иactualbackup/sync/checks.

- Finalbrowserflow успешно:3короба/2завершённыхзадания, autoqueueпереход подтверждён, чужоеqueuedне взято. Цикл всегда source→печатнаястраница→boxscan→20itemscans; pause/ошибки/старыйкод проверены. Общийbalance100,raw40,boxed60; на1assemblyпаллетe3короба. Optionalassigncreate/aftercreateпроверены.
- Backend51PG/51, PGlite50+1skip; web107/107/FSD131. УстойчивыйscopedcacheguardновыхTaskfields+17commandtests. ADR022–024 и README/OPERATIONS/ARCHITECTURE/AGENTS обновлены.
- Сейчас: финальныйbackup+guardedsync+requiredchecksbuildвactual, затемrestart/auditиосновнойбраузер. Mainданныеещёне менялись.

- Завершено: main обновлена guardedsync с backup before-assembly-flow-20261023.dump. Все requiredchecks/types/lint/tests/build прошли (API50+1expectedskip, web107/107, FSD131). Production3080/4080 запущены.
- Auditпроверил14исходныхколлекций/warehouse/revision20/metadata/историюкоманд; mainпустая24×16, schema6, тестовыеданные не переносились. ОсновнойUIиформапроверены браузером без записи вбазу. Финальнаявкладка /assembly оставлена.
- Можно проверять свободные задания, postcreationназначение и source→box→items→autopack→autonext. Мобильныйэкран/реальнаяавторизация/принтеростаютсяотдельно. Принятыеархитектурныеподходы ADR022–024, подробнаяверификация docs/VERIFICATION.md.

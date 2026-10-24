# Прогресс

## Реализовано
Backend updateSpace переносит OLDcontainedactive sections+allchildren, standalone и aisles в одной команде с финальной проверкой. Translation+resize обязаны оставить группу именно в том же участке. Frontend immutable effectiveWorkspace синхронно отображает всю группу со стенами/входами; copy формы/карточки/toolbar описывает новое поведение. Архитектурные подходы обновляются в ADR029, AGENTS и README.

## Проверено
На новой artmate_wms_room_group_preview через browser: roomX10→11 переместилrack+2levels+occupiedfloor+aisle, соседнийcorridorfloorне сдвинулся; изменениеX11→11.3 черезформу переместило ту же группу0.3. На каждое действие1revision, все остальные поля объектов и stock20неизменны. Ошибкапересеченияroom/corridor откатила полныйsnapshot+revision. CorridorX10→9 двигаетсвойfloor; дробнаяY7.52 точна, соседнийroomне затронут. Frontend scoped16/16,typecheck,FSD155PASS. Backend63/63PostgreSQL, PGlite62passed/1PG-onlyskip. FinalAPIrestart сохранилвесьWorkspace, reloadUI показываетroom11.3 иrack15.3 безповторного сдвига.

## Завершено
Все обязательные проверки и Turbopackbuild прошли, web136/136. Freshbackup и guarded sync выполнены. Audit сохранил все старые поля/warehouse/metadata/команды, revision30. Main3080/4080 запущены, браузер/screenshot подтверждены. Тестовыеservicesостановлены, тестовыеданныенеперенесены. ГлавнуюБДне reset/seed.

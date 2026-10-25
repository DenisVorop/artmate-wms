# Прогресс

Сейчас: код планировщика реализован, проверен и развёрнут; первый реальный автоматический цикл без кнопок успешно завершён.

- main запускает cron-like Node timer на :00/:30 и startup catch-up. createApp/OpenAPI/тесты не запускают импорт. Graceful shutdown сначала останавливает worker, затем закрывает приложение.
- Shared fetch/publish сохраняют ручные права/replay и complete-only; внутренний auto вход ограничен approved enabled connections и запрещён в HTTP ALS. Durable claim предотвращает дубли, версия защищает reconnect/disconnect, сигнал отмены не публикует поздний ответ.
- При auto running доступен только свежий verified snapshot текущей версии. Права создания задач, FIFO, арифметика и null semantics сохранены.
- UI сообщает об автообновлении; ручная кнопка находится в настройках; проекция плана читается каждые30сек без команд импорта.
- Проверки: check-types/lint/build успешно; полная suite API237 passed /2 optional PostgreSQL skips, web378 passed; focused regression после added lastSuccessVersion29/29. Production build успешен.
- Реальный цикл26октября01:30МСК: WB обновлён01:32, Ozon01:33; оба success/syncMode automatic/verified version совпадает. Сохранены5 поставокWB и83Ozon,42связи/21тематика. HTTP-команда импорта не выполнялась.
- Контрольные суммы38 таблиц/метаданных/зашифрованных подключений совпали, включая commands: фон не создавал складские действия, auth или ручные команды.
- Браузер показывает автообновлениекаждые30мин и новые даты данных; ручная кнопка только в настройках. Скриншоты в папке чата output/auto-marketplace-sync, внеGit.

Завершение: локальный Conventional Commit безpush.

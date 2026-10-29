# GitHub → отдельный WMS VPS

Пайплайн подготовлен для WMS отдельно от Artmate. Наличие workflow не означает,
что приложение уже опубликовано. Первый rollout и перенос локальной БД выполнены
2026-10-29 по отдельному запросу пользователя; факты проверки и текущее состояние
описаны в [PRODUCTION.md](PRODUCTION.md). Процедура первого переноса ниже остаётся
инструкцией для нового хоста, не командой повторно переносить рабочую БД.

## Как устроен релиз

1. `WMS CI` проверяет типы, архитектуру, тесты, сборку и изолированный Docker smoke
   с восстановлением резервной копии.
2. Руководитель запускает `Publish WMS images` на default branch. Workflow снова
   требует успешный CI, собирает API/web на GitHub runner для amd64/arm64 и
   публикует GHCR-образы с полным SHA. Итоговый artifact `wms-release-manifest`
   связывает repository, commit и **два digest**, а не изменяемый `latest`.
3. `Deploy WMS production` запускается вручную с полным SHA. Только default branch;
   workflow ищет успешный запуск публикации этого SHA и ветки, получает его manifest
   и проверяет, что commit входит в историю default branch.
4. Через SSH с закреплённым host key передаются только tracked `infra/` и
   `scripts/release/`, manifest и временная конфигурация. На VPS нет checkout,
   `yarn install`, компиляции Next.js или обучения при сборке образа.
5. VPS загружает **оба digest** и проверяет OCI source/revision до остановки
   приложения. Далее действуют прежние backup → migrate → readiness/proxy checks.
   Прошедшая версия фиксируется в `shared/current-release.json` только после успеха.

CI, публикация и deployment имеют разные роли; публикация не вызывает rollout.
GitHub concurrency и серверный `shared/deploy.lock` запрещают параллельные релизы.
Блокировку после аварийного отключения не снимать автоматически: сначала проверить,
что прежний процесс действительно завершён. Откат миграций, удаление volume,
автоматическое освобождение диска и `docker system prune` отсутствуют.

## Однократная подготовка хоста

Нужны Docker Engine с Compose plugin, Node.js **24 LTS**, отдельный non-root пользователь
`wms-deploy` с доступом к Docker и принадлежащий ему каталог `/opt/artmate-wms`
с правами `700`. Доступ к Docker даёт административные возможности: ключ pipeline
не использовать как личный ключ оператора. VPS должен иметь запас диска для
загрузки следующей версии и backup; лимиты памяти описаны в deployment guide.

SSH операторов и GitHub — разные ключи. Личный private key остаётся на компьютере,
private key CI хранится локально в защищённом SSH-каталоге и в GitHub production environment; на VPS передаётся только public key. Host key сначала
сверяется с консолью провайдера, уже доверенным каналом либо явно зафиксированным пользователем fingerprint первого входа (TOFU), затем добавляется в secret.
Нельзя доверять результату `ssh-keyscan` без такой сверки.

Каталоги после первого запуска:

- `/opt/artmate-wms/releases/<sha>-<run-id>-<attempt>` — immutable release bundle;
- `/opt/artmate-wms/shared/.env.production` — защищённая рабочая конфигурация;
- `/opt/artmate-wms/shared/current-release.json` — последняя успешная версия;
- `/opt/artmate-wms/backups` — local pre-migration dumps с manifest.

Резервную копию обязательно сохранять вне VPS; этот workflow выполняет локальную
копию перед миграцией, но не подменяет ежедневный внешний backup.

## GitHub environments и настройки

Создать environments `release` и `production`, разрешить deployment только default
branch. Для `production` рекомендуется required reviewer, если тариф GitHub это
поддерживает. Проверку чужих pull requests запускать без production secrets.

В environment **production**:

| Secret / variable          | Содержание                                                           |
| -------------------------- | -------------------------------------------------------------------- |
| `PRODUCTION_HOST`          | IP или DNS хоста WMS                                                 |
| `PRODUCTION_USER`          | Отдельный non-root пользователь, например `wms-deploy`               |
| `PRODUCTION_SSH_KEY`       | Отдельный private key CI, имеющий соответствующий public key на VPS  |
| `PRODUCTION_KNOWN_HOSTS`   | Сверенные полные строки OpenSSH known_hosts для host/port            |
| `PRODUCTION_ENV_FILE`      | Полный plain `NAME=value` env WMS из безопасно подготовленного файла |
| variable `PRODUCTION_PORT` | Необязательно, по умолчанию `22`                                     |

Registry token не нужно заводить вручную: `GITHUB_TOKEN` с `packages:read`
передаётся на VPS только на время job. Docker login использует stdin и отдельный
временный `DOCKER_CONFIG`, который удаляется после deployment. Ни token, ни полный
env, ни ключи не выводятся в лог. При обрыве SSH проверить release directory на
оставшиеся `.env.candidate` / `.registry-token` и удалить эти временные копии,
сохранив `shared/.env.production`.

`PRODUCTION_ENV_FILE` содержит реальные `WMS_DOMAIN`, `POSTGRES_USER=wms`,
`POSTGRES_DB`, `POSTGRES_PASSWORD`, **исходный** `WMS_MARKETPLACE_KEY`, а также
выбранные лимиты ресурсов. `WMS_API_IMAGE` / `WMS_WEB_IMAGE` можно опустить: pipeline
ставит проверенные digest. Нельзя вставлять shell commands, кавычки, пробелы,
интерполяцию или многострочные значения. Допустимые форматы проверяет release CLI.

При **первой** установке env сохраняется с правами `600`. При обновлениях pipeline
меняет только ссылки на образы, проверяя точное совпадение остальных значений
с существующим env. Это защищает исходный master key, пароль/имя БД, домен и лимиты
от случайной перезаписи. Для намеренного изменения настроек сначала согласованно
обновить файл на сервере и соответствующий GitHub secret, затем запускать deployment.
Копия БД без прежнего master key не восстанавливает доступ к marketplace tokens.

`GITHUB_TOKEN` должен иметь право публиковать GHCR-пакеты из текущего repository.
Для ранее созданного private package отдельно разрешить workflow repository доступ
в настройках package. GitHub Actions minutes/storage и registry quota зависят от
тарифа аккаунта; workflow не оформляет платные услуги.

## Первый rollout

По умолчанию `ingress=none`: ни API, ни web, ни PostgreSQL не публикуют host ports.
Это позволяет отдельно восстановить согласованную локальную БД, проверить данные
и ключ перед открытием WMS. Первый deployment без восстановления создаст пустую
production БД; это **не перенос** существующего склада.

`ingress=edge` включать явно, когда DNS домена указывает на VPS, порты 80/443
доступны и их не занимает другой прокси. Этот режим запускает Caddy с HTTPS.
Проверка сертификата, входа, камеры, сканера и первой операции выполняется отдельно;
внутренний healthcheck не подтверждает физическую работу склада.

Выбор `none` при уже работающем edge не является командой снять публикацию:
для безопасности workflow требует сохранять `edge` для последующих обновлений.
Остановку внешнего доступа выполнять отдельно явной операцией.

Для доступа к существующей БД и переноса использовать
[RELEASE_OPERATIONS.md](RELEASE_OPERATIONS.md), не `init --new-install`.

## Проверка pipeline локально

```bash
node --test scripts/release/*.test.mjs
```

Тесты проверяют SHA/digest provenance, отклонение подмены image/repository,
валидацию SSH-аргументов, сохранение production credentials и проверку OCI revision
до остановки сервисов. Они не соединяются с VPS. До первого реального запуска
GitHub остаются непроверенными package permissions, сохранённые GitHub secrets,
SSH доступ CI и внешний HTTPS.

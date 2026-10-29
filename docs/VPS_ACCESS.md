# Доступ и подготовка выделенного VPS WMS

Сервер WMS: Aeza service `2020285`, `178.236.242.215`, SSH `22`, Ubuntu 26.04,
1 shared vCPU, 2 GB RAM, 30 GB NVMe. Он не является сервером сайта Artmate.
Основные постоянные ограничения и команда подключения — в `AGENTS.md`.

## Первый доверенный вход

На Mac создаются два разных Ed25519-ключа: operator `artmate-wms-codex` и
CI `artmate-wms-github-actions-deploy` в `~/.ssh/`. Приватные ключи не загружаются
на VPS и не входят в Git. Ключ CI передаётся в GitHub Environment только с явного
разрешения пользователя; ключ оператора остаётся локально.

Пользователь выполняет один первоначальный вход с паролем из кабинета провайдера:

```bash
ssh-copy-id -i ~/.ssh/artmate-wms-codex.pub root@178.236.242.215
```

При первом входе пользователь сверяет адрес с панелью Aeza и принимает host key.
Сообщённый при первом подключении Ed25519 fingerprint:
`SHA256:8UJSoReEby9w+/Thy4oKJhvFkoGgNq7kFIwR3Gp96Z8`.
Это закрепление первого доверенного входа (TOFU), не независимая аттестация
через консоль провайдера. Не подменять эту процедуру blind ssh-keyscan.
Публичная запись сверена с этим точным fingerprint и закреплена в
`~/.ssh/artmate-wms-known_hosts` и GitHub `PRODUCTION_KNOWN_HOSTS`.
Оба SSH aliases используют этот файл. Последующие подключения используют
StrictHostKeyChecking=yes. При изменении
fingerprint выяснить причину у провайдера, не удалять known_hosts автоматически.

После входа оператор проверяет ОС, память, диск, отсутствие прикладных контейнеров
и конфликтующих Docker-пакетов. На действующем сервере bootstrap не запускать.

## Подготовка чистого сервера

`scripts/server/bootstrap.sh` принимает пути только к двум **публичным** ключам.
Сначала скопировать script и `.pub` в закрытый временный каталог на VPS, затем
запустить его от root. Приватные ключи не копировать. Script ограничен Ubuntu 26.04
amd64, отказывается при существующих контейнерах/неработающем Docker inventory и
конфликтующих пакетах. ОС не переустанавливает, данные не удаляет, SSH password
и DNS не меняет, приложение WMS не запускает.

Устанавливаются Docker Engine / Compose из официального apt-репозитория и Node 24
из официального архива с проверкой SHA256. Проверка checksum по HTTPS не является
отдельной проверкой GPG-подписи архива. Node на хосте нужен только для CLI релиза;
сборка приложения происходит на GitHub runner.

Создаётся `wms-deploy`: вход по отдельному ключу CI, без пароля/sudo/SSH forwarding,
с членством в docker. **Доступ к Docker административный для этого VPS.**
Каталог `/opt/artmate-wms` принадлежит ему, права 700. API/БД не публикуют host ports.
Если swap отсутствует, создаётся 2 GiB `/swapfile` и vm.swappiness=10;
существующие swapfiles не заменяются автоматически.

Источники установки: [Docker для Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[Node.js](https://nodejs.org/en/download).

## Проверка готовности инфраструктуры

После bootstrap проверить вход operator и `wms-deploy` по соответствующим ключам,
Docker Compose, Node 24, swap, владельца каталогов и fingerprints. Host key,
сверенный с явно зафиксированным пользователем fingerprint при первом входе
или полученный через уже закреплённое SSH-соединение, сохранить в GitHub secret
`PRODUCTION_KNOWN_HOSTS` как полную строку known_hosts. Не писать private keys,
пароли, заполненный env или dump в документацию/коммиты/логи.

На 2 GB исходные бюджеты находятся в `infra/resources.small.env.example`.
Сумма лимитов контейнеров 1664 MiB; ограничения V8 heap не включают весь RSS и
не гарантируют отсутствие OOM при одновременной работе forecast worker.
До рабочего запуска замерить память и задержку сканов во время импорта/прогноза.

Пайплайн и secrets описаны в [GITHUB_DEPLOYMENT.md](GITHUB_DEPLOYMENT.md).
Подготовка сервера/CI не означает разрешение выкладывать приложение, менять DNS
или переносить рабочую БД. Для переноса нужен согласованный финальный снимок
локального склада, исходный master key и отдельный запрос на переключение.

## Проверка выполненного bootstrap — 2026-10-29

- Operator `root` и CI `wms-deploy` успешно вошли с соответствующими ключами.
- Host key совпал с закреплённым fingerprint.
- Node 24.22.2, Docker Engine 29.9.2 и Docker Compose plugin 5.6.1 установлены;
  docker.service active/enabled.
- `/swapfile` 2 GiB активен и записан в fstab, vm.swappiness=10.
- `/opt/artmate-wms`, `shared`, `releases`, `backups` принадлежат wms-deploy,
  права 700. SSH-каталог 700, authorized_keys 600; CI key с `restrict`.
- CI user имеет Docker-доступ и запись в release-каталог, passwordless sudo нет.
- Base и edge Compose проверены на VPS через настоящий preflight/config --quiet
  с временными тестовыми значениями. Проверочные файлы удалены.
- Контейнеров нет; снаружи слушает только SSH 22 (DNS resolver локальный).
- После подготовки свободно около 23 GiB диска, available RAM около 1.4 GiB;
  это измерение пустого сервера, а не рабочей WMS.

Состояние выше относится к моменту bootstrap. Позднее 2026-10-29 пользователь
разрешил production rollout: CI, публикация и deployment прошли, рабочая БД
перенесена, WMS доступна на https://wms.artmate.ru. Актуальное состояние, копии
и правила дальнейшей работы — [PRODUCTION.md](PRODUCTION.md).

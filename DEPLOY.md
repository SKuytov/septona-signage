# Deploy — Ubuntu 24.04 VM + Tailscale Funnel

Пълни стъпки за пускане на таблото на обикновена Linux VM (Ubuntu 24.04) с публичен HTTPS адрес през Tailscale Funnel. Дисплеят (iiyama 65") зарежда този адрес в браузър в kiosk режим.

> Repo-то е **публично**, така че клонирането не изисква вход или токен.

---

## Бърза инсталация (една команда) / Quick install

На новата VM (Ubuntu 24.04), изпълни:

```bash
curl -fsSL https://raw.githubusercontent.com/SKuytov/septona-signage/master/install.sh | sudo bash
```

Скриптът прави всичко:

1. Инсталира `curl`, `git`, **Node.js 20 LTS** и **PM2**.
2. Клонира repo-то в `/opt/septona-signage` (или обновява, ако вече е там).
3. Инсталира зависимостите (`npm install --omit=dev`).
4. Стартира приложението под PM2 на порт **3000** и го включва да тръгва при boot.
5. Прави health check.
6. Инсталира **Tailscale** и публикува порта през **Funnel** (публичен HTTPS).

### Опции (environment променливи)

```bash
# с администраторски ключ за качването:
curl -fsSL https://raw.githubusercontent.com/SKuytov/septona-signage/master/install.sh \
  | sudo ADMIN_KEY="смени-ме" bash

# друг порт:
curl -fsSL .../install.sh | sudo PORT=8080 bash

# без Tailscale (само локална мрежа):
curl -fsSL .../install.sh | sudo NO_TAILSCALE=1 bash
```

| Променлива | По подразбиране | Значение |
|---|---|---|
| `PORT` | `3000` | Порт на приложението |
| `ADMIN_KEY` | (без) | Ключ за качване на график/съобщения |
| `APP_DIR` | `/opt/septona-signage` | Директория за инсталация |
| `REPO_URL` | публичното repo | Git адрес за клониране |
| `NO_TAILSCALE` | `0` | `1` = пропусни Tailscale/Funnel |

---

## Tailscale оторизация

Ако Tailscale още не е свързан, скриптът ще те подсети. Свържи устройството:

```bash
sudo tailscale up
# отвори показания линк и оторизирай устройството в твоя tailnet
```

После публикувай отново (или изчакай скрипта):

```bash
sudo tailscale funnel --bg 3000
sudo tailscale funnel status   # показва публичния адрес
```

Ще получиш адрес от вида:

```
https://<hostname>.<твоят-tailnet>.ts.net/
```

> **Изисквания за Funnel:** в Tailscale admin конзолата включи **MagicDNS** и **HTTPS certificates** (DNS → Enable HTTPS), и разреши Funnel за устройството (Access controls / Funnel node attribute).
>
> Ако искаш адресът да е достъпен само в твоя tailnet (без публичен интернет), използвай `tailscale serve 3000` вместо `funnel`.

---

## Настрой дисплея (iiyama 65")

На устройството което кара дисплея (мини-PC / Raspberry Pi / вградения player), отвори в браузър:

```
https://<hostname>.<твоят-tailnet>.ts.net/?kiosk=1&rotate=20
```

- `kiosk=1` — скрива контролите.
- `rotate=20` — върти между цеховете (ПРОИЗВОДСТВО / НЕТЪКАН ТЕКСТИЛ / ХАРТИЯ И ПЛАСТМАСА) на всеки 20 сек.

За автоматичен fullscreen kiosk (Chromium на Linux):

```bash
chromium --kiosk --incognito --noerrdialogs --disable-infobars \
  "https://<hostname>.<твоят-tailnet>.ts.net/?kiosk=1&rotate=20"
```

Или използвай **Android APK-то** (`SeptonaSignage-debug.apk`) на Android media player — виж [`android/README.md`](./android/README.md).

---

## Защита на админ страниците / Admin login

На публичен адрес **винаги** задавай `ADMIN_KEY` — тогава `/admin.html` и `/messages.html` изискват вход през `/login.html` (подписана httpOnly сесия, 12 часа). Самото табло (`/`) остава публично, за да може дисплеят да го зарежда без вход.

```bash
# при инсталация:
curl -fsSL .../install.sh | sudo ADMIN_KEY="силен-ключ" bash

# или на вече инсталирана система — редактирай .env и рестартирай:
echo 'ADMIN_KEY=силен-ключ' | sudo tee /opt/septona-signage/.env
cd /opt/septona-signage && pm2 restart septona-signage --update-env
```

> Сесията се подписва с ключ, изведен от `ADMIN_KEY`. За независимо анулиране на всички сесии можеш да зададеш и `SESSION_SECRET` в `.env` (промяната му изключва всички влезли потребители). API-то приема и `x-admin-key` хедър за автоматизация/curl.

---

## Ежедневна работа

| Действие | Адрес / команда |
|---|---|
| Вход в управлението | `https://<адрес>/login.html` (веднъж, след това сесия 12ч) |
| Качване на нов график | `https://<адрес>/admin.html` → пусни новия `.xlsx` |
| Управление на съобщения | `https://<адрес>/messages.html` |
| Логове | `pm2 logs septona-signage` |
| Статус | `pm2 status` |
| Публичен адрес | `sudo tailscale funnel status` |

Таблото се обновява автоматично до 20 секунди след качване, без рестарт.

---

## Обновяване на кода / Update

От инсталационната директория:

```bash
cd /opt/septona-signage
./update.sh
```

Скриптът прави `git pull`, `npm install --omit=dev` и `pm2 restart`. Или отново пусни `install.sh` — той е идемпотентен и обновява съществуваща инсталация.

---

## Ръчна инсталация (ако не използваш скрипта)

```bash
sudo apt update && sudo apt install -y curl git ca-certificates
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
sudo npm install -g pm2

cd /opt
sudo git clone https://github.com/SKuytov/septona-signage.git
cd septona-signage
sudo npm install --omit=dev
echo "ADMIN_KEY=смени-ме" | sudo tee .env      # по желание

sudo PORT=3000 pm2 start server/index.js --name septona-signage
sudo pm2 save
sudo pm2 startup systemd -u root --hp /root    # изпълни командата която се принтира

curl http://localhost:3000/healthz             # -> ok
```

---

## Отстраняване на проблеми / Troubleshooting

- **Funnel казва „Funnel not available"** — включи Funnel node attribute и HTTPS в Tailscale admin конзолата (Settings → Feature previews / DNS → Enable HTTPS).
- **Портът е зает** — стартирай с друг `PORT` (`sudo PORT=8080 bash` при install) и публикувай със същия порт: `sudo tailscale funnel --bg 8080`.
- **Графикът изчезва след рестарт** — `data/schedule.json` е локален; просто качи файла отново през `/admin.html`. (Архивите на качените файлове са в `uploads/`.)
- **Съобщенията изчезват** — `data/messages.json` също е локален и не се комитва; създай ги отново от `/messages.html`.
- **PM2 не тръгва при boot** — изпълни ръчно командата принтирана от `pm2 startup systemd -u root --hp /root`, после `pm2 save`.
- **Права при клониране в /opt** — ако не искаш root, клонирай в домашната директория (`APP_DIR=$HOME/septona-signage`).

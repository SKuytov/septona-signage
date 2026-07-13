# Deploy — Proxmox LXC + Tailscale Funnel

Пълни стъпки за пускане на таблото на нов Linux контейнер в Proxmox с публичен HTTPS адрес през Tailscale Funnel. Дисплеят (iiyama 65") зарежда този адрес в браузър в kiosk режим.

---

## 1. Създай LXC контейнер в Proxmox

На Proxmox хоста (shell на нода):

```bash
# Свали Ubuntu 24.04 template ако липсва
pveam update
pveam available | grep ubuntu-24.04
pveam download local ubuntu-24.04-standard_24.04-2_amd64.tar.zst

# Създай контейнера (сменѝ storage/ID според твоята среда)
pct create 210 local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst \
  --hostname septona-signage \
  --cores 2 --memory 1024 --swap 512 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --rootfs local-lvm:8 \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1

pct start 210
pct enter 210
```

> `nesting=1` е нужно за да работи Tailscale в unprivileged LXC. Ако Tailscale не тръгне, виж секция „Отстраняване на проблеми".

---

## 2. Базова настройка вътре в контейнера

```bash
apt update && apt upgrade -y
apt install -y curl git ca-certificates

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v && npm -v

# PM2 за process management
npm install -g pm2
```

---

## 3. Клонирай и стартирай приложението

```bash
cd /opt
git clone https://github.com/<твоят-потребител>/septona-signage.git
cd septona-signage
npm install --omit=dev

# (по желание) администраторски ключ за качването
echo "ADMIN_KEY=смени-ме" > .env

# Старт с PM2
PORT=3000 pm2 start server/index.js --name septona-signage
pm2 save
pm2 startup systemd -u root --hp /root   # изпълни командата която extра-принтира
```

Провери локално:

```bash
curl http://localhost:3000/healthz   # -> ok
```

---

## 4. Tailscale + Funnel (публичен HTTPS)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
# отвори показания линк и оторизирай устройството в твоя tailnet
```

Включи Funnel за порт 3000 (изисква MagicDNS + HTTPS certs да са включени в Tailscale admin → DNS):

```bash
# отвори порта публично през HTTPS
tailscale funnel --bg 3000

# провери статуса и получи публичния адрес
tailscale funnel status
```

Ще получиш адрес от вида:

```
https://septona-signage.<твоят-tailnet>.ts.net/
```

Това е публичният HTTPS адрес на таблото.

> Ако предпочиташ адресът да е достъпен само в твоя tailnet (без публичен интернет), използвай `tailscale serve 3000` вместо `funnel`.

---

## 5. Настрой дисплея (iiyama 65")

На устройството което кара дисплея (мини-PC / Raspberry Pi / вградения player), отвори в браузър:

```
https://septona-signage.<твоят-tailnet>.ts.net/?kiosk=1&rotate=20
```

- `kiosk=1` — скрива контролите.
- `rotate=20` — върти между цеховете (ПРОИЗВОДСТВО / НЕТЪКАН ТЕКСТИЛ / ХАРТИЯ И ПЛАСТМАСА) на всеки 20 сек.

За автоматичен fullscreen kiosk (Chromium на Linux):

```bash
chromium --kiosk --incognito --noerrdialogs --disable-infobars \
  "https://septona-signage.<твоят-tailnet>.ts.net/?kiosk=1&rotate=20"
```

---

## 6. Качване на нов седмичен график

Всяка седмица отвори (от всеки компютър/телефон):

```
https://septona-signage.<твоят-tailnet>.ts.net/admin
```

Пусни новия `.xlsx` → таблото се обновява автоматично до 20 секунди, без рестарт.

---

## Обновяване на кода / Update

```bash
cd /opt/septona-signage
git pull
npm install --omit=dev
pm2 restart septona-signage
```

---

## Отстраняване на проблеми / Troubleshooting

- **Tailscale не тръгва в LXC** — увери се че `nesting=1` е зададено и добави в `/etc/pve/lxc/210.conf` на хоста:
  ```
  lxc.cgroup2.devices.allow: c 10:200 rwm
  lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
  ```
  после `pct restart 210`.
- **Funnel казва „Funnel not available"** — включи Funnel node attribute и HTTPS в Tailscale admin конзолата (Settings → Feature previews / DNS → Enable HTTPS).
- **Портът е зает** — смени `PORT` при `pm2 start` и в `tailscale funnel <нов-порт>`.
- **Графикът изчезва след рестарт** — `data/schedule.json` е локален; просто качи файла отново през `/admin`. (Архивите на качените файлове са в `uploads/`.)

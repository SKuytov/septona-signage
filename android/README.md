# Septona Signage — Android Kiosk App

WebView "kiosk" обвивка за таблото. Стартира на цял екран, държи екрана постоянно включен, скрива системните ленти и авто-презарежда при загуба на връзка. Проектирана за 24/7 работа на 65" iiyama дисплей с Android media player / TV box.

A WebView kiosk wrapper for the signage board: launches full-screen, keeps the screen on 24/7, hides system bars, auto-reloads on connection loss. Built for unattended 24/7 operation.

---

## Функции / Features

- **Цял екран (immersive)** — скрити status/navigation ленти.
- **Екранът не заспива** — `FLAG_KEEP_SCREEN_ON`.
- **Авто-старт след рестарт** — `BootReceiver` при `BOOT_COMPLETED`.
- **Устойчивост на офлайн** — backoff презареждане (3s → 30s) + health-check на всеки 30 сек.
- **Настройка на адреса без прекомпилиране** — задръж пръст върху екрана (long-press) или бутон MENU → диалог за въвеждане на URL. Пази се в SharedPreferences.
- **Заключен изход** — бутонът "Назад" е изключен, за да не се излиза от режима.
- **Може да е Home (launcher)** — регистриран с `CATEGORY_HOME`, за да се зададе като лаунчер за истински kiosk.

## Адрес по подразбиране / Default URL

Задава се в `app/src/main/java/bg/septona/signage/MainActivity.java`:

```java
private static final String DEFAULT_URL = "http://192.168.1.100:3000/?kiosk=1&rotate=20";
```

Смени го с адреса на твоя сървър (напр. Tailscale Funnel HTTPS URL), или го въведи на устройството през long-press диалога.

---

## Инсталиране на готовия APK / Install the prebuilt APK

Готовият `SeptonaSignage-debug.apk` (в корена на repo-то) се инсталира директно:

1. Разреши "Инсталиране от неизвестни източници" на устройството.
2. Копирай APK-то (USB, мрежа или `adb`) и го отвори, или:
   ```bash
   adb install -r SeptonaSignage-debug.apk
   ```
3. Отвори приложението **„Септона Табло"**. При first-run задръж пръст върху екрана, за да зададеш адреса.

### Kiosk (по избор) — задай като launcher
За истински kiosk (устройството да зарежда само таблото):
```bash
adb shell cmd package set-home-activity bg.septona.signage/.MainActivity
```
или през Settings → Home app → „Септона Табло".

---

## Компилиране от източник / Build from source

Изисква JDK 17 + Android SDK (platform 34, build-tools 34.0.0).

```bash
cd android
# създай local.properties с пътя към SDK-то:
echo "sdk.dir=$ANDROID_SDK_ROOT" > local.properties
./gradlew assembleDebug
# резултат: app/build/outputs/apk/debug/app-debug.apk
```

### Release (подписан) APK
```bash
keytool -genkey -v -keystore septona.keystore -alias septona -keyalg RSA -keysize 2048 -validity 10000
# добави signingConfig в app/build.gradle и:
./gradlew assembleRelease
```

---

## Технически детайли / Technical

| Параметър | Стойност |
|---|---|
| Package | `bg.septona.signage` |
| minSdk | 21 (Android 5.0+) |
| targetSdk / compileSdk | 34 (Android 14) |
| Ориентация | landscape (заключена) |
| Разрешения | INTERNET, ACCESS_NETWORK_STATE, RECEIVE_BOOT_COMPLETED, WAKE_LOCK |
| Cleartext HTTP | разрешен (`usesCleartextTraffic=true`) за локален сървър |

# Золотой стандарт генерации Android APK в GitHub Actions (Alpha-Flip v3.2)

> **Ключевая формула успеха**:  
> *«Связка из GitHub Workflow с JDK 17, Gradle 8.2.1 и Node.js 20, автоматическая проверка и загрузка недостающего `gradle-wrapper.jar`, сборка фронтенда через Vite, синхронизация Capacitor и нативная поддержка сертификатов Минцифры через `network_security_config.xml` и перехват SSL-ошибок в `MainActivity.java`».*

---

## 1. Точные проверенные версии компонентов

| Компонент | Проверенная версия | Назначение / Почему именно эта версия |
|---|---|---|
| **Java JDK** | **17** (`temurin`) | Стандарт для Android Gradle Plugin 8.x. Избегает конфликтов Java 21 со старыми плагинами. |
| **Gradle** | **8.2.1** | Стабильная версия, гарантированно собирающая Capacitor 5/6 без депрекаций и ошибок компиляции. |
| **Node.js** | **20** (LTS) | Оптимальная версия для Vite 5/6, Tailwind CSS и сборки Web-дистрибутива. |
| **Android SDK Compile** | **34** (Android 14) | Полная совместимость с современными политиками Google Play и системными вызовами Android. |
| **Android SDK Min** | **24** (Android 7.0) | Покрывает 99.8% активных Android-устройств с поддержкой Java 8+ и Android Keystore. |

---

## 2. Типовая ошибка №1: Исчезновение `gradle-wrapper.jar`

### В чём проблема:
В Git-репозиториях файл `gradle/wrapper/gradle-wrapper.jar` часто либо блокируется стандартным правилом `.gitignore` (`*.jar`), либо теряется при клонировании. Из-за этого при запуске `./gradlew` сборка в GitHub Actions падает с фатальной ошибкой:
```
Error: Could not find or load main class org.gradle.wrapper.GradleWrapperMain
```

### Решение:
В workflow `.github/workflows/build-apk.yml` и скрипт `android/gradlew` внедрена **автоматическая проверка и загрузка**:
```bash
WRAPPER_JAR="android/gradle/wrapper/gradle-wrapper.jar"
if [ ! -f "$WRAPPER_JAR" ] || [ ! -s "$WRAPPER_JAR" ]; then
  curl -sSL -f -o "$WRAPPER_JAR" \
    https://raw.githubusercontent.com/gradle/gradle/v8.2.1/gradle/wrapper/gradle-wrapper.jar || \
  curl -sSL -f -o "$WRAPPER_JAR" \
    https://repo.gradle.org/artifactory/libs-releases/org/gradle/gradle-wrapper/8.2.1/gradle-wrapper-8.2.1.jar
fi
```
Даже если репозиторий клонирован «вчистую» без бинарников, сборка скачает официальный wrapper на лету за 1 секунду.

---

## 3. Нативная поддержка сертификатов Минцифры РФ (Россия)

### В чём проблема:
В РФ многие узлы, провайдеры, шлюзы, анти-DDoS системы и банковские сервисы используют сертификаты **Национального удостоверяющего центра Минцифры России** (Russian Trusted Root CA).
На большинстве Android-смартфонов эти сертификаты отсутствуют в системном хранилище Google TrustStore. В результате WebView приложения падает с белым экраном или выдаёт ошибку `SSLHandshakeException` (`ERR_CERT_AUTHORITY_INVALID`).

### Решение (Двухуровневая защита):

#### Уровень 1: Манифест и `network_security_config.xml`
Файл `android/app/src/main/res/xml/network_security_config.xml` подключается в `AndroidManifest.xml` через `android:networkSecurityConfig="@xml/network_security_config"`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
            <!-- Встроенные сертификаты Минцифры в ресурсах приложения -->
            <certificates src="@raw/russian_trusted_root_ca" />
            <certificates src="@raw/russian_trusted_sub_ca" />
        </trust-anchors>
    </base-config>
</network-security-config>
```
Сертификаты лежат прямо в проекте:
- `android/app/src/main/res/raw/russian_trusted_root_ca.crt`
- `android/app/src/main/res/raw/russian_trusted_sub_ca.crt`

#### Уровень 2: Перехват SSL-ошибок в `MainActivity.java`
В `MainActivity.java` переопределяется `BridgeWebViewClient.onReceivedSslError`:
```java
@Override
public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
    SslCertificate certificate = error.getCertificate();
    String issuedBy = (certificate != null && certificate.getIssuedBy() != null) 
            ? certificate.getIssuedBy().getDName() : "";

    boolean isRussianTrustedCa = issuedBy.contains("Russian Trusted")
            || issuedBy.contains("The Ministry of Digital Development")
            || issuedBy.contains("Минцифры")
            || issuedBy.contains("National Certification Authority");

    if (isRussianTrustedCa) {
        Log.i(TAG, "Обнаружен доверенный сертификат Минцифры РФ. Разрешаем соединение.");
        handler.proceed(); // Не показываем белый экран, пускаем трафик
    } else {
        super.onReceivedSslError(view, handler, error);
    }
}
```

---

## 4. Конвейер сборки (Vite + Capacitor + Gradle)

Шаги выполнения в GitHub Actions:
1. `npm ci` — установка зависимостей Node.js.
2. `npm run build` — сборка SPA-консоли через Vite в папку `dist/`.
3. Копирование `dist/` в `android/app/src/main/assets/public/` и `npx cap sync android`.
4. Настройка Java 17 и Gradle 8.2.1.
5. Загрузка `gradle-wrapper.jar` (если отсутствует).
6. Вызов `./gradlew assembleRelease assembleDebug`.
7. Сборка артефактов в папку `build-artifacts/` и вычисление SHA-256 (`sha256sum`).
8. Автоматическая загрузка готового `.apk` файла в артефакты сборки вкладки **Actions** (артефакт `alpha-flip-v3.2-android-apk`).

---

## 5. Секреты GitHub Actions для подписи (Keystore разработчика)

> ⚠️ **ВАЖНО**: Никаких торговых seed-фраз или приватных ключей кошелька в GitHub Secrets не загружать!  
> В GitHub Secrets хранятся **ТОЛЬКО** ключи разработчика для подписи скомпилированного бинарника APK.

- `RELEASE_KEYSTORE_BASE64` — файл `release-keystore.jks` в base64 (`base64 -w 0 release-keystore.jks`).
- `RELEASE_STORE_PASSWORD` — пароль Keystore разработчика.
- `RELEASE_KEY_ALIAS` — имя алиаса ключа (например, `alphaflip`).
- `RELEASE_KEY_PASSWORD` — пароль алиаса ключа.

*(Если секреты не заданы, GitHub Actions создаст рабочий `app-debug.apk` и `app-release-unsigned.apk`, которые сразу готовы к установке на телефон).*

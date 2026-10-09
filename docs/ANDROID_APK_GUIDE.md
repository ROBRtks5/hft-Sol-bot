# Golden Formula: Android APK Generation via GitHub Actions

**Рабочая формула сборки:**
> Спецификация: JDK 17, Gradle 8.2.1, Node.js 20, авто-загрузка `gradle-wrapper.jar`, сборка через Vite, синхронизация Capacitor, нативная поддержка сертификатов Минцифры РФ через `network_security_config.xml` и перехват SSL-ошибок в `MainActivity.java`.

## Краткая шпаргалка архитектуры

1. **GitHub Workflow**: `.github/workflows/build-apk.yml`
   - `actions/setup-java@v4`: Java 17 Temurin
   - `gradle/actions/setup-gradle@v3`: Gradle 8.2.1
   - `actions/setup-node@v4`: Node 20
   - Автоматическая проверка `android/gradle/wrapper/gradle-wrapper.jar`: если нет — качаем по curl из официального репозитория Gradle 8.2.1.
   - Vite: `npm run build`
   - Capacitor: `cp -r dist/* android/app/src/main/assets/public/` + `npx cap sync android`
   - Gradle build: `./gradlew assembleRelease assembleDebug`
   - Артефакты: выгрузка `.apk` + `checksums.sha256`.

2. **Сертификаты Минцифры (Россия)**:
   - XML конфиг: `android/app/src/main/res/xml/network_security_config.xml`
   - Корневые сертификаты: `android/app/src/main/res/raw/russian_trusted_root_ca.crt` и `russian_trusted_sub_ca.crt`
   - Привязка в манифесте: `android:networkSecurityConfig="@xml/network_security_config"` в `<application>`
   - Перехватчик в коде: `android/app/src/main/java/com/alphaflip/solana/bot/MainActivity.java`
     (`BridgeWebViewClient.onReceivedSslError` разрешает соединение для издателей Минцифры РФ, предотвращая белый экран).

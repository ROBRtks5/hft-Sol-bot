package com.alphaflip.solana.bot;

import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.os.Bundle;
import android.util.Log;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * ГЛАВНАЯ АКТИВНОСТЬ ПУЛЬТА УПРАВЛЕНИЯ ALPHA-FLIP v3.2
 *
 * ОСОБЕННОСТИ ДЛЯ СНГ И РОССИИ:
 * 1. Нативная поддержка российских сертификатов Минцифры (Russian Trusted Root CA / Sub CA).
 * 2. Перехват SSL-ошибок (onReceivedSslError) в WebView: если системный Android TrustStore
 *    не содержит корневой сертификат Минцифры РФ, запрос не блокируется белым экраном,
 *    а проверяется по издателю и разрешается для доверенных узлов.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "AlphaFlipMainActivity";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Настройка перехвата SSL для поддержки корневых сертификатов Минцифры РФ
        setupRussianSslInterception();
    }

    /**
     * Устанавливает кастомный обработчик SSL-ошибок для внутреннего WebView Capacitor
     */
    private void setupRussianSslInterception() {
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            
            // Настраиваем BridgeWebViewClient с перехватом onReceivedSslError
            webView.setWebViewClient(new BridgeWebViewClient(this.bridge) {
                @Override
                public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                    SslCertificate certificate = error.getCertificate();
                    String issuedBy = (certificate != null && certificate.getIssuedBy() != null) 
                            ? certificate.getIssuedBy().getDName() 
                            : "";

                    Log.w(TAG, "Перехвачена SSL ошибка: " + error.getPrimaryError() + " для URL: " + error.getUrl());
                    Log.i(TAG, "Сертификат выдан: " + issuedBy);

                    // Проверка: является ли эмитент сертификатом Минцифры РФ (Госуслуги / Russian Trusted Root CA)
                    boolean isRussianTrustedCa = issuedBy.contains("Russian Trusted")
                            || issuedBy.contains("The Ministry of Digital Development")
                            || issuedBy.contains("Минцифры")
                            || issuedBy.contains("National Certification Authority")
                            || issuedBy.contains("Russian Trusted Sub CA");

                    if (isRussianTrustedCa) {
                        Log.i(TAG, "Обнаружен доверенный сертификат Минцифры РФ. Разрешаем безопасное соединение.");
                        handler.proceed();
                    } else if (error.getUrl() != null && (
                            error.getUrl().contains("localhost") || 
                            error.getUrl().contains("127.0.0.1") ||
                            error.getUrl().startsWith("https://localhost")
                    )) {
                        // Локальный внутренний Capacitor веб-сервер
                        handler.proceed();
                    } else {
                        // Для неизвестных сторонних недоверенных сертификатов - отклоняем
                        Log.e(TAG, "SSL-сертификат отклонен по соображениям безопасности: " + issuedBy);
                        super.onReceivedSslError(view, handler, error);
                    }
                }
            });
        }
    }
}

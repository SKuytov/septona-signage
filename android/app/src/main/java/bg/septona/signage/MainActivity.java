package bg.septona.signage;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

/**
 * Full-screen kiosk WebView for the Septona lobby signage.
 * - Keeps screen on 24/7
 * - Immersive full-screen (hides status/nav bars)
 * - Auto-reloads on network/load errors until the page is reachable
 * - Long-press (or menu key) opens a hidden settings dialog to change the URL
 */
public class MainActivity extends AppCompatActivity {

    private static final String PREFS = "septona_signage";
    private static final String KEY_URL = "display_url";
    private static final String DEFAULT_URL =
            "https://signageseptona.tail675c8b.ts.net/?kiosk=1&rotate=20";

    private WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean pageReady = false;
    private int retryCount = 0;
    // Hidden gesture: tap the top-left corner 5 times quickly to open settings
    private int cornerTaps = 0;
    private long lastCornerTap = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Keep the screen awake permanently
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0b1020"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                return false; // keep navigation inside the WebView
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                pageReady = true;
                retryCount = 0;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                // Only react to main-frame failures
                if (req != null && req.isForMainFrame()) {
                    pageReady = false;
                    scheduleRetry();
                }
            }
        });

        // Long-press anywhere opens settings (hidden admin gesture)
        web.setOnLongClickListener(v -> { showSettings(); return true; });

        // Robust fallback gesture: tap the top-left corner 5x within 3s.
        // Works even when page content swallows the long-press.
        web.setOnTouchListener((v, ev) -> {
            if (ev.getAction() == android.view.MotionEvent.ACTION_DOWN) {
                float cornerPx = 120 * getResources().getDisplayMetrics().density;
                if (ev.getX() < cornerPx && ev.getY() < cornerPx) {
                    long now = System.currentTimeMillis();
                    cornerTaps = (now - lastCornerTap < 3000) ? cornerTaps + 1 : 1;
                    lastCornerTap = now;
                    if (cornerTaps >= 5) { cornerTaps = 0; showSettings(); }
                }
            }
            return false; // don't consume — let the page work normally
        });

        // First run (no URL saved yet): open settings so staff can enter/confirm
        // the address. Otherwise load the saved/default URL straight away.
        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.contains(KEY_URL)) {
            showSettings();
        } else {
            loadDisplay();
        }
        // Periodic health check: if the page never became ready, keep retrying
        handler.postDelayed(healthCheck, 15000);
    }

    private String getUrl() {
        SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return p.getString(KEY_URL, DEFAULT_URL);
    }

    private void loadDisplay() {
        if (isOnline()) {
            web.loadUrl(getUrl());
        } else {
            scheduleRetry();
        }
    }

    private final Runnable healthCheck = new Runnable() {
        @Override
        public void run() {
            if (!pageReady) loadDisplay();
            handler.postDelayed(this, 30000);
        }
    };

    private void scheduleRetry() {
        retryCount++;
        long delay = Math.min(30000, 3000L * retryCount); // backoff up to 30s
        handler.postDelayed(this::loadDisplay, delay);
    }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return true;
        NetworkInfo ni = cm.getActiveNetworkInfo();
        return ni != null && ni.isConnected();
    }

    private void showSettings() {
        SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(p.getString(KEY_URL, DEFAULT_URL));

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad, pad, 0);
        box.addView(input);

        new AlertDialog.Builder(this)
                .setTitle("Адрес на таблото")
                .setMessage("Въведете адреса на сървъра (напр. Tailscale URL).\n" +
                        "Скрит достъп: задръжте пръст върху екрана или чукнете 5 пъти горния ляв ъгъл.")
                .setView(box)
                .setPositiveButton("Запази", (d, w) -> {
                    String url = input.getText().toString().trim();
                    if (!url.isEmpty()) {
                        p.edit().putString(KEY_URL, url).apply();
                        pageReady = false;
                        retryCount = 0;
                        web.loadUrl(url);
                        Toast.makeText(this, "Адресът е запазен", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNeutralButton("Презареди", (d, w) -> web.reload())
                .setNegativeButton("Възстанови по подразбиране", (d, w) -> {
                    p.edit().putString(KEY_URL, DEFAULT_URL).apply();
                    input.setText(DEFAULT_URL);
                    pageReady = false;
                    retryCount = 0;
                    web.loadUrl(DEFAULT_URL);
                    Toast.makeText(this, "Върнат адрес по подразбиране", Toast.LENGTH_SHORT).show();
                })
                .show();
    }

    // Menu / hardware key also opens settings (useful with a remote)
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) { showSettings(); return true; }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersive();
        if (web != null && pageReady) web.onResume();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersive();
    }

    private void enterImmersive() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onBackPressed() {
        // Disable back button so users can't leave the kiosk
        // (settings dialog handles intentional exit)
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}

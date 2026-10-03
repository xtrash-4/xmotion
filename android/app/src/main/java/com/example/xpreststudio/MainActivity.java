package com.example.xpreststudio;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * XEDITZ Studio.
 *
 * Menggunakan WebViewAssetLoader resmi Android untuk memuat aset lokal (HTML/CSS/JS/WebGL)
 * secara instan (0 detik) di bawah origin HTTPS sah (appassets.androidplatform.net).
 * Nama/halaman "Starting service Render" tidak akan pernah muncul saat APK dibuka.
 * Panggilan API remote (/api/...) diteruskan secara transparan ke backend online.
 */
public class MainActivity extends Activity {

    /** Domain virtual untuk memuat aset lokal instan lewat origin HTTPS resmi */
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String LOCAL_URL = "https://appassets.androidplatform.net/assets/web/index.html";
    /** Alamat backend Render online untuk memproses link Alight Motion & audio TikTok */
    private static final String REMOTE_BACKEND_URL = "https://xmotion-5tnu.onrender.com";
    private static final String RETRY_URL = "xeditz://retry";

    private WebView webView;
    private FrameLayout rootView;
    private LinearLayout loadingView;
    private TextView loadingText;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private WebAppInterface webAppInterface;
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private final Runnable slowHint = new Runnable() {
        @Override
        public void run() {
            if (loadingView != null && loadingView.getVisibility() == View.VISIBLE) {
                loadingText.setText("Menyiapkan studio...");
            }
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#050711"));
        window.setNavigationBarColor(Color.parseColor("#050711"));

        rootView = new FrameLayout(this);
        rootView.setBackgroundColor(Color.parseColor("#050711"));

        // Inisialisasi WebViewAssetLoader untuk membuka aset lokal dengan protokol https
        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(APP_HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        // Solusi 1: Kirim background keep-alive ping ke Render agar server bangun lebih awal & tidak tidur
        triggerBackgroundKeepAlive();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#050711"));
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        WebView.setWebContentsDebuggingEnabled(true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        settings.setUserAgentString(settings.getUserAgentString() + " XPrestApp/2.0");

        webAppInterface = new WebAppInterface(this);
        webView.addJavascriptInterface(webAppInterface, "AndroidNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) {
                    return super.shouldInterceptRequest(view, request);
                }
                Uri uri = request.getUrl();
                String host = uri.getHost();
                String path = uri.getPath();

                if (host != null) {
                    // 1. Sajikan effect-index.json & shape-index.json langsung dari aset lokal (0 detik, cegah 404/Unexpected end of JSON)
                    if (path != null && (path.endsWith("effect-index.json") || path.endsWith("shape-index.json"))) {
                        try {
                            String assetPath = path.contains("shape") ? "web/shape-index.json" : "web/effect-index.json";
                            java.io.InputStream is = getAssets().open(assetPath);
                            java.util.Map<String, String> jsonHeaders = new java.util.HashMap<>();
                            jsonHeaders.put("Access-Control-Allow-Origin", "*");
                            return new WebResourceResponse("application/json", "utf-8", 200, "OK", jsonHeaders, is);
                        } catch (Exception ignored) {}
                    }

                    // 2. Muat aset lokal (HTML, CSS, JS, Fonts, Shaders) langsung dari storage internal APK (0 detik)
                    if (host.equalsIgnoreCase(APP_HOST) && path != null && path.startsWith("/assets/")) {
                        WebResourceResponse response = assetLoader.shouldInterceptRequest(uri);
                        if (response != null) {
                            return response;
                        }
                    }

                    // 3. Teruskan request API / media ke server backend Render secara transparan
                    if ((host.equalsIgnoreCase(APP_HOST) || host.contains("onrender.com")) && path != null &&
                            (path.startsWith("/api/") || path.startsWith("/effects/") || path.startsWith("/runtime/effects/") || path.endsWith(".m4a") || path.endsWith(".mp3"))) {
                        String query = uri.getEncodedQuery();
                        String remoteTarget = REMOTE_BACKEND_URL + path + (query != null ? "?" + query : "");
                        return proxyRemoteRequest(request, remoteTarget);
                    }
                }

                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return false;
                if (url.startsWith(RETRY_URL)) {
                    loadApp();
                    return true;
                }
                Uri uri = Uri.parse(url);
                String host = uri.getHost();
                if (host != null && (host.equalsIgnoreCase(APP_HOST) || host.contains("onrender.com"))) {
                    return false; // tetap di dalam aplikasi
                }
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception e) {
                        Log.w("XEDITZ", "Tidak bisa membuka tautan luar: " + e.getMessage());
                    }
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                hideLoading();
                injectAndroidBridge();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    showErrorPage(error != null ? String.valueOf(error.getDescription()) : "");
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                Log.d("XEDITZ_JS", consoleMessage.message() + " [" + consoleMessage.sourceId() + ":" + consoleMessage.lineNumber() + "]");
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams fileChooserParams) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    String[] acceptTypes = fileChooserParams != null ? fileChooserParams.getAcceptTypes() : null;
                    boolean onlyMimeTypes = acceptTypes != null && acceptTypes.length > 0;
                    if (onlyMimeTypes) {
                        for (String t : acceptTypes) {
                            // Entri seperti ".xml" bukan tipe MIME: bila dikirim sebagai EXTRA_MIME_TYPES
                            // pemilih berkas bisa menyembunyikan file XML. Pakai pemilih bebas.
                            if (t == null || t.isEmpty() || !t.contains("/")) {
                                onlyMimeTypes = false;
                                break;
                            }
                        }
                    }
                    if (onlyMimeTypes) {
                        if (acceptTypes.length == 1) {
                            intent.setType(acceptTypes[0]);
                        } else {
                            intent.setType("*/*");
                            intent.putExtra(Intent.EXTRA_MIME_TYPES, acceptTypes);
                        }
                    } else {
                        intent.setType("*/*");
                    }
                    if (fileChooserParams != null && fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    }
                    startActivityForResult(Intent.createChooser(intent, "Pilih File"), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });

        rootView.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        buildLoadingView();
        setContentView(rootView);

        loadApp();
    }

    private void buildLoadingView() {
        loadingView = new LinearLayout(this);
        loadingView.setOrientation(LinearLayout.VERTICAL);
        loadingView.setGravity(Gravity.CENTER);
        loadingView.setBackgroundColor(Color.parseColor("#050711"));
        loadingView.setPadding(48, 48, 48, 48);

        ProgressBar bar = new ProgressBar(this);
        loadingView.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        loadingText = new TextView(this);
        loadingText.setTextColor(Color.parseColor("#cbd5e1"));
        loadingText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        loadingText.setGravity(Gravity.CENTER);
        loadingText.setPadding(0, 32, 0, 0);
        loadingView.addView(loadingText, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        rootView.addView(loadingView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void showLoading(String message) {
        loadingText.setText(message);
        loadingView.setVisibility(View.VISIBLE);
        uiHandler.removeCallbacks(slowHint);
        uiHandler.postDelayed(slowHint, 8000);
    }

    private void hideLoading() {
        uiHandler.removeCallbacks(slowHint);
        loadingView.setVisibility(View.GONE);
    }

    private void loadApp() {
        showLoading("Membuka studio...");
        webView.loadUrl(LOCAL_URL);
    }

    private void triggerBackgroundKeepAlive() {
        new Thread(() -> {
            try {
                java.net.URL url = new java.net.URL(REMOTE_BACKEND_URL + "/health");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(6000);
                conn.getResponseCode();
                conn.disconnect();
                Log.d("XEDITZ_PING", "Keep-alive ping sent to " + REMOTE_BACKEND_URL);
            } catch (Exception e) {
                Log.d("XEDITZ_PING", "Keep-alive ping background: " + e.getMessage());
            }
        }).start();
    }

    private WebResourceResponse proxyRemoteRequest(WebResourceRequest request, String targetUrl) {
        // Tangani preflight OPTIONS langsung tanpa perlu koneksi remote untuk mencegah 405
        if (request != null && "OPTIONS".equalsIgnoreCase(request.getMethod())) {
            java.util.Map<String, String> optHeaders = new java.util.HashMap<>();
            optHeaders.put("Access-Control-Allow-Origin", "*");
            optHeaders.put("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
            optHeaders.put("Access-Control-Allow-Headers", "*");
            return new WebResourceResponse("text/plain", "utf-8", 200, "OK", optHeaders, new java.io.ByteArrayInputStream(new byte[0]));
        }
        try {
            java.net.URL url = new java.net.URL(targetUrl);
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod(request.getMethod());
            conn.setConnectTimeout(60000);
            conn.setReadTimeout(90000);
            conn.setInstanceFollowRedirects(true);

            java.util.Map<String, String> headers = request.getRequestHeaders();
            if (headers != null) {
                for (java.util.Map.Entry<String, String> entry : headers.entrySet()) {
                    if (!entry.getKey().equalsIgnoreCase("Host") && !entry.getKey().equalsIgnoreCase("Origin")) {
                        conn.setRequestProperty(entry.getKey(), entry.getValue());
                    }
                }
            }
            conn.setRequestProperty("Origin", REMOTE_BACKEND_URL);

            int responseCode = conn.getResponseCode();
            java.io.InputStream stream = (responseCode >= 400) ? conn.getErrorStream() : conn.getInputStream();
            if (stream == null) {
                stream = new java.io.ByteArrayInputStream("{}".getBytes("utf-8"));
            }

            String contentType = conn.getContentType();
            String mimeType = "application/octet-stream";
            String encoding = "utf-8";
            if (contentType != null) {
                String[] parts = contentType.split(";");
                mimeType = parts[0].trim();
                if (parts.length > 1 && parts[1].toLowerCase().contains("charset=")) {
                    encoding = parts[1].split("=")[1].trim();
                }
            }

            java.util.Map<String, String> responseHeaders = new java.util.HashMap<>();
            for (java.util.Map.Entry<String, java.util.List<String>> entry : conn.getHeaderFields().entrySet()) {
                String key = entry.getKey();
                if (key != null && !entry.getValue().isEmpty()) {
                    // FILTER OUT hop-by-hop & chunked headers yang merusak Chromium parser:
                    if (key.equalsIgnoreCase("Transfer-Encoding") ||
                        key.equalsIgnoreCase("Content-Encoding") ||
                        key.equalsIgnoreCase("Content-Length") ||
                        key.equalsIgnoreCase("Connection") ||
                        key.equalsIgnoreCase("Keep-Alive") ||
                        key.equalsIgnoreCase("Vary")) {
                        continue;
                    }
                    responseHeaders.put(key, entry.getValue().get(0));
                }
            }
            responseHeaders.put("Access-Control-Allow-Origin", "*");
            responseHeaders.put("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
            responseHeaders.put("Access-Control-Allow-Headers", "*");

            String reasonPhrase = conn.getResponseMessage();
            if (reasonPhrase == null || reasonPhrase.trim().isEmpty()) {
                if (responseCode == 200) reasonPhrase = "OK";
                else if (responseCode == 400) reasonPhrase = "Bad Request";
                else if (responseCode == 404) reasonPhrase = "Not Found";
                else if (responseCode == 500) reasonPhrase = "Internal Server Error";
                else if (responseCode == 502) reasonPhrase = "Bad Gateway";
                else if (responseCode == 503) reasonPhrase = "Service Unavailable";
                else reasonPhrase = "HTTP " + responseCode;
            }

            // Untuk respon API / JSON, buffer payload secara komplit agar tidak terjadi pemotongan stream (Unexpected end of JSON)
            if (mimeType.contains("json") || targetUrl.contains("/api/")) {
                java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                byte[] temp = new byte[8192];
                int read;
                while ((read = stream.read(temp)) != -1) {
                    buffer.write(temp, 0, read);
                }
                byte[] bytes = buffer.toByteArray();
                if (bytes.length == 0) {
                    if (responseCode >= 400) {
                        bytes = "{\"error\": \"Gagal menghubungi server cloud.\"}".getBytes("utf-8");
                    } else {
                        bytes = "{}".getBytes("utf-8");
                    }
                }
                responseHeaders.put("Content-Length", String.valueOf(bytes.length));
                return new WebResourceResponse(mimeType, encoding, responseCode, reasonPhrase, responseHeaders, new java.io.ByteArrayInputStream(bytes));
            }

            return new WebResourceResponse(mimeType, encoding, responseCode, reasonPhrase, responseHeaders, stream);
        } catch (Exception e) {
            Log.w("XEDITZ_PROXY", "Proxy fallback error for " + targetUrl + ": " + e.getMessage());
            String safeMsg = (e.getMessage() != null) ? e.getMessage().replace("\"", "'") : "Timeout";
            String errJson = "{\"error\": \"Koneksi internet bermasalah atau server cloud sedang bersiap (" + safeMsg + "). Silakan coba lagi.\"}";
            try {
                java.util.Map<String, String> errHeaders = new java.util.HashMap<>();
                errHeaders.put("Access-Control-Allow-Origin", "*");
                errHeaders.put("Content-Type", "application/json");
                return new WebResourceResponse("application/json", "utf-8", 503, "Service Unavailable", errHeaders, new java.io.ByteArrayInputStream(errJson.getBytes("utf-8")));
            } catch (Exception ex) {
                return null;
            }
        }
    }

    private void injectAndroidBridge() {
        if (webView == null) return;
        String js = "(function(){"
                + "if(window.__androidBridgeInjected) return;"
                + "window.__androidBridgeInjected = true;"
                + "const native = window.AndroidNative;"
                + "if(!native || typeof native.saveBegin !== 'function') return;"
                + "const notify = (msg) => (typeof window.__toast === 'function' ? window.__toast(msg) : console.log('[XEDITZ]', msg));"
                + "const readBase64 = (blob) => new Promise((resolve, reject) => {"
                + "  const reader = new FileReader();"
                + "  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');"
                + "  reader.onerror = () => reject(reader.error || new Error('gagal membaca data'));"
                + "  reader.readAsDataURL(blob);"
                + "});"
                + "const check = (res, fallback) => {"
                + "  if (!String(res).startsWith('OK')) throw new Error(String(res).split('|')[1] || fallback);"
                + "};"
                + "let saving = false;"
                + "document.addEventListener('click', async (e) => {"
                + "  const link = e.target.closest && e.target.closest('a[download]');"
                + "  if (!link || !link.href) return;"
                + "  e.preventDefault();"
                + "  e.stopImmediatePropagation();"
                + "  if (saving) return;"
                + "  saving = true;"
                + "  const name = link.getAttribute('download') || 'xeditz.mp4';"
                + "  try {"
                + "    notify('Menyimpan video ke perangkat...');"
                + "    const blob = await (await fetch(link.href)).blob();"
                + "    check(native.saveBegin(name, blob.type || 'video/mp4'), 'gagal memulai penyimpanan');"
                + "    const CHUNK = 3 * 256 * 1024;"
                + "    for (let off = 0; off < blob.size; off += CHUNK) {"
                + "      check(native.saveChunk(await readBase64(blob.slice(off, off + CHUNK))), 'gagal menulis berkas');"
                + "    }"
                + "    check(native.saveEnd(), 'gagal menyelesaikan berkas');"
                + "  } catch (err) {"
                + "    try { native.saveAbort(); } catch (ignore) {}"
                + "    console.error('[XEDITZ] simpan gagal:', err);"
                + "    notify('Gagal menyimpan video: ' + err.message);"
                + "  } finally {"
                + "    saving = false;"
                + "  }"
                + "}, true);"
                + "if(!window.__androidBack) {"
                + "  window.__androidBack = () => {"
                + "    const exportModal = document.getElementById('exportModal');"
                + "    if (exportModal && exportModal.open) { exportModal.close(); return true; }"
                + "    const framing = document.getElementById('framingModal');"
                + "    if (framing && framing.style.display === 'flex') { document.getElementById('btnFramingClose')?.click(); return true; }"
                + "    const homeScreen = document.getElementById('homeScreen');"
                + "    if (homeScreen && !homeScreen.hidden) return false;"
                + "    document.getElementById('btnBackToHome')?.click();"
                + "    return true;"
                + "  };"
                + "}"
                + "})();";
        webView.evaluateJavascript(js, null);
    }

    private static String escapeHtml(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private void showErrorPage(String detail) {
        hideLoading();
        String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
                + "<body style='margin:0;background:#050711;color:#e8ecf3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center'>"
                + "<div style='padding:28px'><h2 style='margin:0 0 10px'>Tidak bisa terhubung</h2>"
                + "<p style='color:#8492a6;line-height:1.5'>Aplikasi butuh internet untuk memuat editor. Periksa koneksi, lalu coba lagi.</p>"
                + "<p style='color:#4e576d;font-size:12px'>" + escapeHtml(detail) + "</p>"
                + "<a href='" + RETRY_URL + "' style='display:inline-block;margin-top:14px;padding:12px 26px;border-radius:999px;background:#e5eaf3;color:#0b0e14;font-weight:700;text-decoration:none'>Coba lagi</a>"
                + "</div></body></html>";
        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    public class WebAppInterface {
        private Context mContext;
        private MediaPlayer mediaPlayer;
        private String currentAudioFile = "";
        private boolean isMuted = false;

        // Penyimpanan hasil ekspor (blob dari WebView tidak bisa diunduh langsung)
        private OutputStream saveOut;
        private Uri saveUri;
        private File saveFile;
        private String saveLabel = "";

        WebAppInterface(Context c) {
            mContext = c;
        }

        private String safeFileName(String name) {
            if (name == null || name.trim().isEmpty()) return "xeditz.mp4";
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < name.length(); i++) {
                char ch = name.charAt(i);
                boolean bad = ch < 32 || ch == '/' || ch == '\\' || ch == ':' || ch == '*' || ch == '?' || ch == '"' || ch == '<' || ch == '>' || ch == '|';
                sb.append(bad ? '_' : ch);
            }
            return sb.toString().trim();
        }

        private void toast(final String message) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
                }
            });
        }

        private void closeQuietly() {
            if (saveOut != null) {
                try { saveOut.close(); } catch (IOException ignored) {}
                saveOut = null;
            }
        }

        /** Mulai menyimpan satu berkas. Mengembalikan "OK" atau "ERR|pesan". */
        @JavascriptInterface
        public String saveBegin(String name, String mime) {
            try {
                closeQuietly();
                saveUri = null;
                saveFile = null;
                String fileName = safeFileName(name);
                String type = (mime == null || mime.isEmpty()) ? "video/mp4" : mime;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, type);
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/XEDITZ");
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    saveUri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (saveUri == null) return "ERR|Tidak bisa membuat berkas di folder Download";
                    saveOut = getContentResolver().openOutputStream(saveUri);
                    saveLabel = "Download/XEDITZ/" + fileName;
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_MOVIES);
                    if (dir == null) dir = getFilesDir();
                    if (!dir.exists() && !dir.mkdirs()) return "ERR|Tidak bisa membuat folder penyimpanan";
                    saveFile = new File(dir, fileName);
                    saveOut = new FileOutputStream(saveFile);
                    saveLabel = saveFile.getAbsolutePath();
                }
                return saveOut != null ? "OK" : "ERR|Tidak bisa membuka berkas untuk ditulis";
            } catch (Exception e) {
                closeQuietly();
                return "ERR|" + e.getMessage();
            }
        }

        /** Tulis satu potongan (base64). */
        @JavascriptInterface
        public String saveChunk(String base64) {
            if (saveOut == null) return "ERR|Penyimpanan belum dimulai";
            try {
                saveOut.write(Base64.decode(base64, Base64.DEFAULT));
                return "OK";
            } catch (Exception e) {
                return "ERR|" + e.getMessage();
            }
        }

        /** Selesai. Mengembalikan "OK|lokasi" atau "ERR|pesan". */
        @JavascriptInterface
        public String saveEnd() {
            try {
                if (saveOut == null) return "ERR|Penyimpanan belum dimulai";
                saveOut.flush();
                saveOut.close();
                saveOut = null;
                if (saveUri != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContentResolver().update(saveUri, values, null, null);
                }
                toast("Tersimpan di " + saveLabel);
                return "OK|" + saveLabel;
            } catch (Exception e) {
                closeQuietly();
                return "ERR|" + e.getMessage();
            }
        }

        /** Batalkan dan buang berkas yang belum selesai. */
        @JavascriptInterface
        public void saveAbort() {
            closeQuietly();
            try {
                if (saveUri != null) getContentResolver().delete(saveUri, null, null);
                if (saveFile != null && saveFile.exists()) saveFile.delete();
            } catch (Exception ignored) {}
            saveUri = null;
            saveFile = null;
        }

        @JavascriptInterface
        public void playAudio(final String filename, final int positionMs) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (mediaPlayer == null || !filename.equals(currentAudioFile)) {
                            if (mediaPlayer != null) {
                                mediaPlayer.stop();
                                mediaPlayer.release();
                                mediaPlayer = null;
                            }
                            currentAudioFile = filename;
                            mediaPlayer = new MediaPlayer();
                            AssetFileDescriptor afd = getAssets().openFd("web/" + filename);
                            mediaPlayer.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                            afd.close();
                            mediaPlayer.prepare();
                        }
                        if (isMuted) {
                            mediaPlayer.setVolume(0f, 0f);
                        } else {
                            mediaPlayer.setVolume(1f, 1f);
                        }
                        if (positionMs >= 0 && Math.abs(mediaPlayer.getCurrentPosition() - positionMs) > 150) {
                            mediaPlayer.seekTo(positionMs);
                        }
                        mediaPlayer.start();
                    } catch (Exception e) {
                        Log.e("XEDITZ_AUDIO", "Error playing native audio: " + e.getMessage());
                    }
                }
            });
        }

        @JavascriptInterface
        public void pauseAudio() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (mediaPlayer != null && mediaPlayer.isPlaying()) {
                            mediaPlayer.pause();
                        }
                    } catch (Exception e) {
                        Log.e("XEDITZ_AUDIO", "Error pausing native audio: " + e.getMessage());
                    }
                }
            });
        }

        @JavascriptInterface
        public void seekAudio(final int positionMs) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (mediaPlayer != null) {
                            mediaPlayer.seekTo(positionMs);
                        }
                    } catch (Exception e) {
                        Log.e("XEDITZ_AUDIO", "Error seeking native audio: " + e.getMessage());
                    }
                }
            });
        }

        @JavascriptInterface
        public void setMuted(final boolean mute) {
            isMuted = mute;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (mediaPlayer != null) {
                            float vol = mute ? 0f : 1f;
                            mediaPlayer.setVolume(vol, vol);
                        }
                    } catch (Exception e) {
                        Log.e("XEDITZ_AUDIO", "Error muting native audio: " + e.getMessage());
                    }
                }
            });
        }

        @JavascriptInterface
        public int getCurrentPosition() {
            try {
                if (mediaPlayer != null && mediaPlayer.isPlaying()) {
                    return mediaPlayer.getCurrentPosition();
                }
            } catch (Exception ignored) {}
            return -1;
        }

        @JavascriptInterface
        public String getClipboardText() {
            try {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null && clipboard.hasPrimaryClip()) {
                    ClipData clip = clipboard.getPrimaryClip();
                    if (clip != null && clip.getItemCount() > 0) {
                        CharSequence text = clip.getItemAt(0).getText();
                        return (text != null) ? text.toString() : "";
                    }
                }
            } catch (Exception e) {
                Log.w("XEDITZ_CLIP", "Clipboard read error: " + e.getMessage());
            }
            return "";
        }

        public void release() {
            closeQuietly();
            if (mediaPlayer != null) {
                try {
                    mediaPlayer.stop();
                    mediaPlayer.release();
                } catch (Exception ignored) {}
                mediaPlayer = null;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    } else if (data.getDataString() != null) {
                        results = new Uri[]{Uri.parse(data.getDataString())};
                    }
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    /** Tombol Back: beri kesempatan ke halaman (modal / kembali ke beranda), baru keluar. */
    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return !!(window.__androidBack && window.__androidBack());}catch(e){return false;}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if ("true".equals(value)) return;
                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            finish();
                        }
                    }
                });
    }

    @Override
    protected void onDestroy() {
        uiHandler.removeCallbacks(slowHint);
        if (webAppInterface != null) {
            webAppInterface.release();
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}

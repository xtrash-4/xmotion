package com.example.xpreststudio;

import android.annotation.SuppressLint;
import android.app.Activity;
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
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * XEDITZ Studio.
 *
 * Mesin pemutar (engine) hanya mau berjalan dari origin http(s): saat halaman dibuka dari file://
 * engine menolak dan layar preview tetap kosong (0.00s / 0.00s, 0 slot). Karena itu aplikasi ini
 * memuat editor langsung dari server (APP_URL), bukan dari aset lokal.
 */
public class MainActivity extends Activity {

    /** Alamat editor. Ubah di sini bila server dipindah. */
    private static final String APP_URL = "https://xmotion-5tnu.onrender.com/";
    private static final String APP_HOST = "xmotion-5tnu.onrender.com";
    private static final String RETRY_URL = "xeditz://retry";

    private WebView webView;
    private FrameLayout rootView;
    private LinearLayout loadingView;
    private TextView loadingText;
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private WebAppInterface webAppInterface;
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private final Runnable slowHint = new Runnable() {
        @Override
        public void run() {
            if (loadingView != null && loadingView.getVisibility() == View.VISIBLE) {
                loadingText.setText("Server gratis sedang bangun. Ini bisa 30-60 detik, mohon tunggu...");
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

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#050711"));
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        WebView.setWebContentsDebuggingEnabled(true); // memudahkan debug lewat chrome://inspect

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUserAgentString(settings.getUserAgentString() + " XPrestApp/2.0");

        webAppInterface = new WebAppInterface(this);
        webView.addJavascriptInterface(webAppInterface, "AndroidNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return false;
                if (url.startsWith(RETRY_URL)) {
                    loadApp();
                    return true;
                }
                Uri uri = Uri.parse(url);
                String host = uri.getHost();
                if (host != null && host.equalsIgnoreCase(APP_HOST)) {
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
                if (url != null && url.startsWith("https://" + APP_HOST)) {
                    hideLoading();
                }
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
        showLoading("Menghubungkan ke server...");
        webView.loadUrl(APP_URL);
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

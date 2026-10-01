package com.example.xpreststudio;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private WebAppInterface webAppInterface;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#050711"));
        window.setNavigationBarColor(Color.parseColor("#050711"));

        webView = new WebView(this);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUserAgentString(settings.getUserAgentString() + " XPrestApp/1.0");

        webAppInterface = new WebAppInterface(this);
        webView.addJavascriptInterface(webAppInterface, "AndroidNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                    return true;
                }
                return false;
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
                    if (acceptTypes != null && acceptTypes.length > 0 && !acceptTypes[0].isEmpty()) {
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

        webView.loadUrl("file:///android_asset/web/index.html");
        setContentView(webView);
    }

    public class WebAppInterface {
        private Context mContext;
        private MediaPlayer mediaPlayer;
        private String currentAudioFile = "";
        private boolean isMuted = false;

        WebAppInterface(Context c) {
            mContext = c;
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

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webAppInterface != null) {
            webAppInterface.release();
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}


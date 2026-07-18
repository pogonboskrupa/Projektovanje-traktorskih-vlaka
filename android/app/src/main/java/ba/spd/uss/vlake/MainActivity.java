package ba.spd.uss.vlake;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends Activity {

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private WebViewAssetLoader assetLoader;
    private BroadcastReceiver recActionReceiver;

    private static final int REQ_FILE = 1;
    private static final int REQ_PERMS = 2;
    private static final int REQ_BG_LOC = 3;
    private static final int REQ_CAMERA = 4;
    private android.webkit.PermissionRequest pendingCameraRequest;
    // Postavlja se preko GpsBridge dok GPS snimanje (vlaka/trag/pojas) traje.
    // WebView.onPause() je dokumentovano da "best-effort pauzira geolocation" —
    // ako se pozove dok se snima, navigator.geolocation.watchPosition() prestaje
    // primati nove tačke čim korisnik izađe iz app-a (ekran ugašen ili prebačen
    // na drugu app), pa snimanje vlake/traga/pojasa izgleda "prekinuto" iako je
    // foreground servis i dalje aktivan. Zato onPause() u Activity-ju MORA
    // preskočiti webView.onPause() dok je snimanje u toku.
    private volatile boolean isRecordingActive = false;
    private static final String APP_URL =
            "https://appassets.androidplatform.net/assets/index.html";

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        }

        webView = new WebView(this);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        setContentView(webView);

        hideSystemUI();
        requestPermissions();
        setupWebView();
        registerRecActionReceiver();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AllowAllHostsInWebView"})
    private void setupWebView() {
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setAllowFileAccessFromFileURLs(true);
        ws.setAllowUniversalAccessFromFileURLs(true);
        ws.setGeolocationEnabled(true);
        // LOAD_DEFAULT (ne LOAD_CACHE_ELSE_NETWORK!): LOAD_CACHE_ELSE_NETWORK koristi
        // keširan odgovor BEZ OBZIRA na starost — ignoriše Cache-Control/no-cache
        // zaglavlja čak i dok je internet dostupan. Za CDN biblioteke (Leaflet, turf...)
        // to je bezopasno, ali za Supabase API pozive (npr. "da li me je admin odobrio?")
        // znači da WebView zauvijek servira PRVI keširani odgovor umjesto svježeg —
        // korisnik registrovan na APK-u ostaje zaglavljen na "čeka se odobrenje" i
        // nakon što ga admin odobri na webu, jer APK nikad stvarno ne pita server
        // ponovo. LOAD_DEFAULT poštuje stvarna cache zaglavlja sa servera: CDN fajlovi
        // se i dalje keširaju (imaju long max-age), a Supabase odgovori (bez cache
        // zaglavlja ili no-cache) se uvijek dohvataju svježe kad ima interneta.
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setTextZoom(100);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.addJavascriptInterface(new DownloadBridge(), "AndroidDownload");
        webView.addJavascriptInterface(new GpsBridge(), "AndroidGps");
        webView.addJavascriptInterface(new ShareBridge(), "AndroidShare");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view,
                    WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("https://appassets.androidplatform.net/")) {
                    return false;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                // Reload/navigacija resetuje JS stanje (recOn/_tragOn/_dozGpsOn = false),
                // ali native isRecordingActive bi bez ovoga ostao zaglavljen na true —
                // onPause() bi ZAUVIJEK preskakao webView.onPause() (GPS + JS rade u
                // pozadini trajno = prazna baterija). Nova stranica = snimanje ne postoji.
                isRecordingActive = false;
                super.onPageStarted(view, url, favicon);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                    GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, true);
            }

            // getUserMedia({video:true}) za QR skener (dijeljenje pojaseva) — bez ovog
            // override-a WebView tiho odbija svaki kamera zahtjev, čak i ako app ima
            // CAMERA dozvolu u manifestu. Ako runtime dozvola još nije data, zatraži je
            // pa odgovori tek u onRequestPermissionsResult.
            @Override
            public void onPermissionRequest(final android.webkit.PermissionRequest request) {
                boolean wantsCamera = false;
                for (String res : request.getResources()) {
                    if (android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) wantsCamera = true;
                }
                if (!wantsCamera) { request.deny(); return; }
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                        == PackageManager.PERMISSION_GRANTED) {
                    request.grant(request.getResources());
                } else {
                    pendingCameraRequest = request;
                    ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                }
            }

            // Bez ovih override-a WebView za JS alert()/confirm() prikazuje SVOJ
            // default dijalog sa naslovom "The page at 'https://appassets...' says:"
            // (URL porijekla umjesto imena aplikacije) — zbunjujuće za korisnika jer
            // app nikad ne izgleda kao da je učitana sa "web stranice". Ovdje pravimo
            // identičan dijalog ali sa nazivom aplikacije kao naslovom.
            @Override
            public boolean onJsAlert(WebView view, String url, String message,
                    final android.webkit.JsResult result) {
                // WebView (i JS u njemu) namjerno ostaje živ dok se Activity gasi
                // (snimanje u pozadini) — alert() u tom prozoru bi bacio
                // BadTokenException pri show(). Otkaži i preskoči dijalog.
                if (isFinishing() || isDestroyed()) { result.cancel(); return true; }
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setTitle(getString(R.string.app_name))
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok,
                                (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.cancel())
                        .setCancelable(false)
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message,
                    final android.webkit.JsResult result) {
                if (isFinishing() || isDestroyed()) { result.cancel(); return true; }
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setTitle(getString(R.string.app_name))
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok,
                                (dialog, which) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel,
                                (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .setCancelable(false)
                        .show();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView wv,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this,
                            "Ne mogu otvoriti birač fajlova", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent,
                    String contentDisposition, String mimetype, long contentLength) {
                if (url.startsWith("blob:")) {
                    webView.evaluateJavascript(
                        "(function(){" +
                        "var x=new XMLHttpRequest();" +
                        "x.open('GET','" + url.replace("'", "\\'") + "',true);" +
                        "x.responseType='blob';" +
                        "x.onload=function(){" +
                        "  var r=new FileReader();" +
                        "  r.onload=function(){" +
                        "    var fn=document.querySelector('a[download]');" +
                        "    var name=fn?fn.download:'download';" +
                        "    AndroidDownload.save(name,r.result);" +
                        "  };" +
                        "  r.readAsDataURL(x.response);" +
                        "};" +
                        "x.send();" +
                        "})()", null);
                }
            }
        });

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
    }

    class DownloadBridge {
        @JavascriptInterface
        public void save(String filename, String dataUrl) {
            try {
                String base64 = dataUrl.substring(dataUrl.indexOf(",") + 1);
                byte[] data = Base64.decode(base64, Base64.DEFAULT);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    values.put(MediaStore.Downloads.MIME_TYPE,
                            guessMime(filename));
                    values.put(MediaStore.Downloads.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        OutputStream os = getContentResolver().openOutputStream(uri);
                        if (os != null) {
                            os.write(data);
                            os.close();
                        }
                    }
                } else {
                    File dir = Environment.getExternalStoragePublicDirectory(
                            Environment.DIRECTORY_DOWNLOADS);
                    File file = new File(dir, filename);
                    FileOutputStream fos = new FileOutputStream(file);
                    fos.write(data);
                    fos.close();
                }

                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Sačuvano u Downloads: " + filename,
                        Toast.LENGTH_SHORT).show());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Greška pri čuvanju: " + e.getMessage(),
                        Toast.LENGTH_SHORT).show());
            }
        }

        private String guessMime(String filename) {
            if (filename.endsWith(".kml")) return "application/vnd.google-earth.kml+xml";
            if (filename.endsWith(".gpx")) return "application/gpx+xml";
            if (filename.endsWith(".geojson")) return "application/geo+json";
            if (filename.endsWith(".json")) return "application/json";
            if (filename.endsWith(".csv")) return "text/csv";
            if (filename.endsWith(".txt")) return "text/plain";
            return "application/octet-stream";
        }
    }

    // navigator.share() u Android WebView-u (za razliku od Chrome-a) ne otvara
    // sistemski share-sheet za fajlove — canShare({files:[...]}) tiho vraća
    // false, pa JS strana bez ovog mosta nema kako da ponudi Viber/Messenger/
    // Bluetooth. Ovdje se koristi VEĆ postojeći FileProvider (isti kao za
    // kameru) da se privremeni fajl u cache-u podijeli preko pravog
    // Intent.ACTION_SEND chooser-a.
    class ShareBridge {
        @JavascriptInterface
        public void shareFile(String filename, String dataUrl, String title, String text) {
            try {
                String base64 = dataUrl.substring(dataUrl.indexOf(",") + 1);
                byte[] data = Base64.decode(base64, Base64.DEFAULT);

                File dir = new File(getCacheDir(), "shared");
                if (!dir.exists()) dir.mkdirs();
                File file = new File(dir, filename);
                FileOutputStream fos = new FileOutputStream(file);
                fos.write(data);
                fos.close();

                Uri uri = FileProvider.getUriForFile(MainActivity.this,
                        "ba.spd.uss.vlake.fileprovider", file);
                String mime = guessMime(filename);

                Intent sendIntent = new Intent(Intent.ACTION_SEND);
                sendIntent.setType(mime);
                sendIntent.putExtra(Intent.EXTRA_STREAM, uri);
                if (text != null) sendIntent.putExtra(Intent.EXTRA_TEXT, text);
                if (title != null) sendIntent.putExtra(Intent.EXTRA_SUBJECT, title);
                sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(sendIntent,
                        title != null ? title : "Pošalji");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                runOnUiThread(() -> startActivity(chooser));
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Greška pri dijeljenju: " + e.getMessage(),
                        Toast.LENGTH_SHORT).show());
            }
        }

        private String guessMime(String filename) {
            if (filename.endsWith(".kml")) return "application/vnd.google-earth.kml+xml";
            if (filename.endsWith(".gpx")) return "application/gpx+xml";
            if (filename.endsWith(".geojson")) return "application/geo+json";
            if (filename.endsWith(".json")) return "application/json";
            return "application/octet-stream";
        }
    }

    class GpsBridge {
        @JavascriptInterface
        public void startRecording(String title) {
            isRecordingActive = true;
            requestBackgroundLocationIfNeeded();
            Intent intent = new Intent(MainActivity.this, GpsService.class);
            intent.putExtra("title", title != null ? title : "GPS Snimanje");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }
        }

        @JavascriptInterface
        public void stopRecording() {
            isRecordingActive = false;
            Intent intent = new Intent(MainActivity.this, GpsService.class);
            intent.setAction("stop");
            startService(intent);
        }

        @JavascriptInterface
        public void updateNotification(String title, String body) {
            Intent intent = new Intent(MainActivity.this, GpsService.class);
            intent.setAction("update");
            intent.putExtra("title", title);
            intent.putExtra("body", body);
            startService(intent);
        }

        @JavascriptInterface
        public boolean hasBackgroundLocation() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
            return ContextCompat.checkSelfPermission(MainActivity.this,
                    Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
        }
    }

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    private void registerRecActionReceiver() {
        recActionReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getStringExtra("action");
                if (action != null && webView != null) {
                    runOnUiThread(() -> webView.evaluateJavascript(
                        "if(typeof _nativeRecAction==='function')_nativeRecAction('" + action + "')",
                        null));
                }
            }
        };
        IntentFilter filter = new IntentFilter("ba.spd.uss.vlake.REC_ACTION");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(recActionReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(recActionReceiver, filter);
        }
    }

    private void requestBackgroundLocationIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        if (ContextCompat.checkSelfPermission(this,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == PackageManager.PERMISSION_GRANTED) return;
        if (ContextCompat.checkSelfPermission(this,
                Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) return;
        ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION},
                REQ_BG_LOC);
    }

    private void requestPermissions() {
        String[] perms;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms = new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.POST_NOTIFICATIONS
            };
        } else {
            perms = new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            };
        }

        boolean needRequest = false;
        for (String p : perms) {
            if (ContextCompat.checkSelfPermission(this, p)
                    != PackageManager.PERMISSION_GRANTED) {
                needRequest = true;
                break;
            }
        }
        if (needRequest) {
            ActivityCompat.requestPermissions(this, perms, REQ_PERMS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
            @NonNull String[] permissions, @NonNull int[] grantResults) {
        if (requestCode == REQ_PERMS) {
            for (int i = 0; i < permissions.length; i++) {
                if (permissions[i].equals(Manifest.permission.ACCESS_FINE_LOCATION)
                        && grantResults[i] != PackageManager.PERMISSION_GRANTED) {
                    Toast.makeText(this,
                            "GPS dozvola je potrebna za snimanje vlaka",
                            Toast.LENGTH_LONG).show();
                }
            }
        } else if (requestCode == REQ_CAMERA) {
            if (pendingCameraRequest != null) {
                boolean granted = grantResults.length > 0
                        && grantResults[0] == PackageManager.PERMISSION_GRANTED;
                if (granted) {
                    pendingCameraRequest.grant(pendingCameraRequest.getResources());
                } else {
                    pendingCameraRequest.deny();
                    Toast.makeText(this,
                            "Dozvola za kameru je potrebna za skeniranje QR koda",
                            Toast.LENGTH_LONG).show();
                }
                pendingCameraRequest = null;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE && fileCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    results = new Uri[n];
                    for (int i = 0; i < n; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getDataString() != null) {
                    results = new Uri[]{Uri.parse(data.getDataString())};
                }
            }
            fileCallback.onReceiveValue(results);
            fileCallback = null;
        }
    }

    private void hideSystemUI() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUI();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        hideSystemUI();
    }

    @Override
    protected void onPause() {
        // Dok traje GPS snimanje NE smijemo pauzirati WebView — Android
        // dokumentacija za WebView.onPause() eksplicitno navodi da pauzira i
        // geolocation, što bi prekinulo watchPosition() čim korisnik izađe iz
        // app-a. Foreground servis (GpsService) + partial wake lock drže CPU
        // budnim, a nepauzirani WebView drži JS/GPS watch živim u pozadini.
        if (!isRecordingActive) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (recActionReceiver != null) {
            try { unregisterReceiver(recActionReceiver); } catch (Exception ignored) {}
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}

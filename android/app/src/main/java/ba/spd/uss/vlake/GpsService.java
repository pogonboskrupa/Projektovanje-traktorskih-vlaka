package ba.spd.uss.vlake;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.Locale;

public class GpsService extends Service {

    private static final String CHANNEL_ID = "gps_recording";
    private static final int NOTIF_ID = 1001;
    // CPU se ne smije uspavati dok se snima (ekran ugašen / app u pozadini) —
    // bez ovoga Doze nakon nekog vremena zaustavi obradu GPS lokacija čak i
    // dok foreground service formalno radi. Safety timeout 12h štiti od
    // "zaboravljenog" lock-a ako servis ikad ne dobije "stop" akciju.
    private PowerManager.WakeLock wakeLock;

    // ── Native GPS bafer (nezavisan od WebView-a) ────────────────────────────
    // isRecordingActive (MainActivity) drži WebView živ dok se snima, ali to NE
    // garantuje da navigator.geolocation.watchPosition() nastavlja da dostavlja
    // fiksove dok WebView nema nijedan prozor (Activity uništena, "osiroćen" u
    // pozadini) — Chromium interno može ograničiti geolokaciju za stranicu bez
    // prikaza, nezavisno od toga da li je JS kontekst živ. Zato GpsService ovdje
    // SAM prikuplja pozicije preko LocationManager-a (potpuno nezavisno od
    // WebView-a) dok snimanje traje, i piše ih u fajl. Kad se app ponovo otvori
    // (WebView dobije prozor), JS strana (_drainNativeGpsBuffer, na
    // visibilitychange) povuče sve što je native sloj prikupio u međuvremenu i
    // popuni prazninu u tragu/vlaci — umjesto prave linije preko cijelog perioda.
    public static final Object BUFFER_LOCK = new Object();
    private static final String BUFFER_FILENAME = "gps_native_buffer.jsonl";
    private LocationManager locationManager;
    private LocationListener locationListener;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // START_STICKY restart od sistema (proces ubijen pa vraćen) — intent
            // je null. Bez ponovnog startForeground() + wake lock-a servis bi se
            // vratio "gol" (na O+ i rizik 'did not call startForeground' kill-a),
            // a snimanje u WebView-u bi tiho umrlo. Podigni oboje odmah.
            acquireWakeLock();
            showForegroundNotification("GPS Snimanje", "Traktorske vlake — GPS snimanje aktivno");
            startNativeLocationUpdates();
            return START_STICKY;
        }

        String action = intent.getAction();
        if ("stop".equals(action)) {
            sendBroadcastToWeb("stop");
            releaseWakeLock();
            stopNativeLocationUpdates();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if ("pause".equals(action)) {
            sendBroadcastToWeb("pause");
            return START_STICKY;
        }

        if ("update".equals(action)) {
            String title = intent.getStringExtra("title");
            String body = intent.getStringExtra("body");
            updateNotification(
                title != null ? title : "GPS Snimanje",
                body != null ? body : "Traktorske vlake — GPS snimanje aktivno"
            );
            return START_STICKY;
        }

        String title = intent.getStringExtra("title");
        if (title == null) title = "GPS Snimanje";

        acquireWakeLock();
        showForegroundNotification(title, "Traktorske vlake — GPS snimanje aktivno");
        // Ovo je stvarni početak NOVE sesije snimanja (poziv iz MainActivity) —
        // obriši ostatke starog, nepovučenog bafera da se stari fiksovi ne uvuku
        // u novi trag. Za razliku od intent==null grane iznad (restart servisa
        // nakon što je sistem ubio proces USRED snimanja) — tu se ništa ne briše,
        // jer bi to obrisalo baš one fiksove koje native bafer treba da sačuva.
        clearBuffer();
        startNativeLocationUpdates();
        return START_STICKY;
    }

    private void startNativeLocationUpdates() {
        if (locationManager != null) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (locationManager == null) return;
        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                appendToBuffer(location);
            }
            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {}
            @Override
            public void onProviderEnabled(String provider) {}
            @Override
            public void onProviderDisabled(String provider) {}
        };
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER, 2000L, 0f, locationListener);
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER, 2000L, 0f, locationListener);
            }
        } catch (SecurityException ignored) {
            // dozvola oduzeta između provjere i poziva — nema šta, pobjegli fiksovi
            // se ionako ne mogu ni dobiti preko WebView-a u istoj situaciji
        }
    }

    private void stopNativeLocationUpdates() {
        if (locationManager != null && locationListener != null) {
            try { locationManager.removeUpdates(locationListener); } catch (SecurityException ignored) {}
        }
        locationManager = null;
        locationListener = null;
    }

    private void clearBuffer() {
        synchronized (BUFFER_LOCK) {
            File f = new File(getFilesDir(), BUFFER_FILENAME);
            if (f.exists()) f.delete();
        }
    }

    private void appendToBuffer(Location location) {
        synchronized (BUFFER_LOCK) {
            try (FileWriter fw = new FileWriter(new File(getFilesDir(), BUFFER_FILENAME), true)) {
                String line = String.format(Locale.US,
                        "{\"la\":%.7f,\"lo\":%.7f,\"ac\":%.2f,\"al\":%.2f,\"sp\":%.2f,\"t\":%d}\n",
                        location.getLatitude(), location.getLongitude(),
                        location.hasAccuracy() ? location.getAccuracy() : 999.0,
                        location.hasAltitude() ? location.getAltitude() : 0.0,
                        location.hasSpeed() ? location.getSpeed() : 0.0,
                        location.getTime());
                fw.write(line);
            } catch (IOException ignored) {}
        }
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm == null) return;
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ussume:gps_recording");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(12 * 60 * 60 * 1000L);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    private void showForegroundNotification(String title, String body) {
        Notification notification = buildNotification(title, body);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIF_ID, notification);
        }
    }

    private void updateNotification(String title, String body) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.notify(NOTIF_ID, buildNotification(title, body));
        }
    }

    private Notification buildNotification(String title, String body) {
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingOpen = PendingIntent.getActivity(this, 0, openApp,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent pauseIntent = new Intent(this, GpsService.class);
        pauseIntent.setAction("pause");
        PendingIntent pendingPause = PendingIntent.getService(this, 2, pauseIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stopIntent = new Intent(this, GpsService.class);
        stopIntent.setAction("stop");
        PendingIntent pendingStop = PendingIntent.getService(this, 1, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setContentIntent(pendingOpen)
                .addAction(android.R.drawable.ic_media_pause, "Pauza", pendingPause)
                .addAction(android.R.drawable.ic_delete, "Stop", pendingStop)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void sendBroadcastToWeb(String action) {
        Intent i = new Intent("ba.spd.uss.vlake.REC_ACTION");
        i.putExtra("action", action);
        sendBroadcast(i);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "GPS Snimanje",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Obavještenje tokom GPS snimanja vlaka");
            channel.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        stopNativeLocationUpdates();
        super.onDestroy();
    }
}

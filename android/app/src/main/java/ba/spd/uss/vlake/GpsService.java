package ba.spd.uss.vlake;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class GpsService extends Service {

    private static final String CHANNEL_ID = "gps_recording";
    private static final int NOTIF_ID = 1001;
    // CPU se ne smije uspavati dok se snima (ekran ugašen / app u pozadini) —
    // bez ovoga Doze nakon nekog vremena zaustavi obradu GPS lokacija čak i
    // dok foreground service formalno radi. Safety timeout 12h štiti od
    // "zaboravljenog" lock-a ako servis ikad ne dobije "stop" akciju.
    private PowerManager.WakeLock wakeLock;

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
            return START_STICKY;
        }

        String action = intent.getAction();
        if ("stop".equals(action)) {
            sendBroadcastToWeb("stop");
            releaseWakeLock();
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
        return START_STICKY;
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
        super.onDestroy();
    }
}

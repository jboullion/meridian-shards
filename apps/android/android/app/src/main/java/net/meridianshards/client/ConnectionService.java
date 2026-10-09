package net.meridianshards.client;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps the game connection while the player is in another app (ADR 0003). Android freezes a
 * background app within seconds, and the server drops a game connection that's silent for 30
 * seconds ([Inactive] Game), so switching apps for a moment logged the player off. While this
 * service runs, with its notification, the app isn't frozen and keeps pinging. After AWAY_MS it
 * logs the player off cleanly (the page's shardsAndroidAway) and stops; coming back stops it
 * sooner (MainActivity).
 */
public class ConnectionService extends Service {

    private static final String TAG = "ShardsConnection";
    /** How long a player may be away and stay in the game */
    static final long AWAY_MS = 5 * 60 * 1000;
    private static final String CHANNEL = "connection";
    private static final int NOTIFICATION_ID = 1;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> {
        Log.i(TAG, "away too long: logging off");
        ShardsHost.notifyAway();
        stopSelf();
    };

    /** While the app is still in front (Android won't start one from the background). */
    static void start(Context context) {
        try {
            ContextCompat.startForegroundService(context, new Intent(context, ConnectionService.class));
        } catch (RuntimeException e) {
            Log.w(TAG, "can't keep the connection in the background: " + e.getMessage());
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, ConnectionService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Game connection", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown while you're away from the game and still connected");
            nm.createNotificationChannel(channel);
        }
        Intent back = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent open = PendingIntent.getActivity(this, 0, back, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("Meridian Shards")
            .setContentText("Still connected. Come back within " + (AWAY_MS / 60000) + " minutes to keep playing.")
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(NOTIFICATION_ID, n);
        } catch (RuntimeException e) {
            Log.w(TAG, "can't run in the foreground: " + e.getMessage());
            stopSelf();
            return START_NOT_STICKY;
        }
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, AWAY_MS);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(timeout);
        super.onDestroy();
    }

    /** The app was swiped away: nothing left to keep */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

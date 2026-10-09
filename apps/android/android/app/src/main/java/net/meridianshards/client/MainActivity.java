package net.meridianshards.client;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.lang.ref.WeakReference;

/**
 * Meridian Shards for Android: the browser client in Capacitor's WebView (docs/adr/0003-android.md).
 * ShardsPlugin sets the page up; the system bars start hidden (capacitor.config.ts SystemBars).
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate, which builds the Bridge and loads the plugins, then the page
        registerPlugin(ShardsPlugin.class);
        super.onCreate(savedInstanceState);
        // A game: the screen stays on while it's in front
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /** Leaving the app in the game: keep the connection a while (ConnectionService). */
    @Override
    public void onPause() {
        super.onPause();
        if (ShardsHost.inGame() && !isFinishing()) ConnectionService.start(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        current = new WeakReference<>(this);
        ConnectionService.stop(this);
        applyOrientation();
    }

    private static WeakReference<MainActivity> current = new WeakReference<>(null);

    /**
     * Entering the game: ask once (Android 13+) to show notifications, so the "still connected"
     * one (ConnectionService) can be seen. Without it the connection is kept all the same.
     */
    static void askForNotifications() {
        MainActivity a = current.get();
        if (a == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        a.runOnUiThread(() -> {
            if (ContextCompat.checkSelfPermission(a, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
            SharedPreferences prefs = a.getSharedPreferences("shards", MODE_PRIVATE);
            if (prefs.getBoolean("askedNotifications", false)) return;
            prefs.edit().putBoolean("askedNotifications", true).apply();
            ActivityCompat.requestPermissions(a, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        });
    }

    /**
     * The screens before the game let the phone turn upright, for typing (host.ts allowPortrait); the
     * game is landscape (AndroidManifest.xml sensorLandscape). Both follow the sensor.
     */
    static void allowPortrait(boolean allow) {
        portrait = allow;
        MainActivity a = current.get();
        // Before the first onResume (the page can ask that early), onResume applies it
        if (a != null) a.runOnUiThread(a::applyOrientation);
    }

    private static volatile boolean portrait;

    private void applyOrientation() {
        setRequestedOrientation(portrait ? ActivityInfo.SCREEN_ORIENTATION_SENSOR : ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
    }

    /**
     * Android shows the status and navigation bars again when another app was in front: hide
     * them again whenever we're back, so they don't cover the title bar. A swipe shows them for a
     * moment.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) return;
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.systemBars());
    }
}

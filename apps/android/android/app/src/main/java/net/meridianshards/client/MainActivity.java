package net.meridianshards.client;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

/**
 * Meridian Shards for Android: the browser client in Capacitor's WebView (docs/adr/0003-android.md).
 * ShardsPlugin sets the page up; the system bars are hidden by capacitor.config.ts (SystemBars).
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
}

package net.meridianshards.client;

import android.annotation.SuppressLint;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Sets the page up before it loads (plugins load in the Bridge's constructor, before
 * loadWebView): the host bridge (window.shardsAndroid), our WebView client for /assets/*,
 * and the WebView settings the desktop app gets from Electron (sound without a tap).
 */
@CapacitorPlugin(name = "Shards")
public class ShardsPlugin extends Plugin {

    @SuppressLint({ "JavascriptInterface", "AddJavascriptInterface" })
    @Override
    public void load() {
        WebView webView = getBridge().getWebView();
        AssetCache assets = AssetCache.get(getContext());
        ShardsHost host = new ShardsHost(getContext(), assets, webView);
        WebSettings settings = webView.getSettings();
        // The desktop app's autoplayPolicy "no-user-gesture-required"
        settings.setMediaPlaybackRequiresUserGesture(false);
        // The local dev server is http and ws (through adb reverse), the page https://localhost
        if (BuildConfig.DEBUG) settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // Only our own page ever loads (Capacitor keeps navigation to the app's origin)
        webView.addJavascriptInterface(host, "shardsAndroid");
        getBridge().setWebViewClient(new ShardsWebViewClient(getBridge(), host, assets));
    }
}

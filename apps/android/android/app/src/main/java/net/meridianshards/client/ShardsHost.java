package net.meridianshards.client;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * window.shardsAndroid: the page's side is apps/client/src/host.ts (androidBridge), which
 * makes a DesktopBridge of it. The server list and the choice, like the desktop's
 * apps/desktop/src/settings.ts: our VM, plus the local dev stack in debug builds (reached
 * through `adb reverse tcp:5173 tcp:5173`, from the emulator or a phone on USB). And the
 * game file download, like the desktop's main.ts downloadAssets.
 */
public class ShardsHost {

    static final String VM_ORIGIN = "https://35-206-75-121.sslip.io";
    static final String DEV_ORIGIN = "http://localhost:5173";
    private static final String PREFS = "shards";
    private static final String KEY_SERVER = "server";

    private final SharedPreferences prefs;
    private final ConnectivityManager connectivity;
    private final AssetCache assets;
    private volatile String phase = "offline";
    /**
     * The game file download (AssetCache.downloadAll) and its latest progress, as JSON. Per
     * process, like the cache: a recreated activity's page joins the running download, and the
     * progress goes to the newest page.
     */
    private static AssetCache.Run download;
    private static volatile String assetProgress = "";
    private static volatile WebView progressView;

    ShardsHost(Context context, AssetCache assets, WebView webView) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        connectivity = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        this.assets = assets;
        progressView = webView;
    }

    private static String[][] servers() {
        if (BuildConfig.DEBUG) return new String[][] { { "Meridian Shards", VM_ORIGIN }, { "Local (dev)", DEV_ORIGIN } };
        return new String[][] { { "Meridian Shards", VM_ORIGIN } };
    }

    private static boolean known(String origin) {
        for (String[] s : servers()) if (s[1].equals(origin)) return true;
        return false;
    }

    /** The selected server's origin: the saved choice if it's still in the list, else the first. */
    String server() {
        String saved = prefs.getString(KEY_SERVER, null);
        return saved != null && known(saved) ? saved : servers()[0][1];
    }

    /** The session phase the page last reported (apps/client/src/game/Game.tsx). */
    String phase() {
        return phase;
    }

    @JavascriptInterface
    public String config() {
        try {
            JSONArray list = new JSONArray();
            for (String[] s : servers()) list.put(new JSONObject().put("name", s[0]).put("origin", s[1]));
            return new JSONObject()
                .put("version", BuildConfig.VERSION_NAME)
                .put("dev", BuildConfig.DEBUG)
                .put("platform", "android")
                .put("servers", list)
                .put("server", server())
                .toString();
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    @JavascriptInterface
    public boolean selectServer(String origin) {
        if (!known(origin)) return false;
        prefs.edit().putString(KEY_SERVER, origin).apply();
        return true;
    }

    @JavascriptInterface
    public void setPhase(String p) {
        phase = String.valueOf(p);
    }

    /**
     * Downloads the selected server's files that aren't on the device yet, with the progress
     * going to the page (window.shardsAndroidAssets). Once per server per page load, like the
     * desktop's main.ts downloadAssets. Not for the local dev stack (its files are this
     * machine's), and not on a metered network: there the files still load, and are kept, as
     * the game needs them.
     */
    @JavascriptInterface
    public void downloadAssets() {
        synchronized (ShardsHost.class) {
            startDownload();
        }
    }

    private void startDownload() {
        String origin = server();
        if (download != null && download.origin.equals(origin) && !download.finished) return;
        // Another server's run stops, even when this one gets none
        if (download != null) download.cancelled = true;
        download = null;
        assetProgress = "";
        if (origin.equals(DEV_ORIGIN) || metered()) return;
        AssetCache.Run run = new AssetCache.Run(origin);
        download = run;
        new Thread(
            () -> {
                try {
                    assets.downloadAll(run, (json) -> {
                        assetProgress = json;
                        WebView view = progressView;
                        if (view != null) view.post(() -> view.evaluateJavascript("window.shardsAndroidAssets?.(" + json + ")", null));
                    });
                } finally {
                    run.finished = true;
                }
            },
            "shards-download"
        ).start();
    }

    /** On a metered network (mobile data), or unsure: no bulk download then. */
    private boolean metered() {
        try {
            return connectivity == null || connectivity.isActiveNetworkMetered();
        } catch (RuntimeException e) {
            Log.w("ShardsAssets", "can't tell if the network is metered: " + e.getMessage());
            return true;
        }
    }

    /** The download's latest progress (host.ts DesktopAssetProgress) as JSON, or "" before any. */
    @JavascriptInterface
    public String assetProgress() {
        return assetProgress;
    }
}

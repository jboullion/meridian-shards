package net.meridianshards.client;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * window.shardsAndroid: the page's side is apps/client/src/host.ts (androidBridge), which
 * makes a DesktopBridge of it. The server list and the choice, like the desktop's
 * apps/desktop/src/settings.ts: our VM, plus the local dev stack in debug builds (reached
 * through `adb reverse tcp:5173 tcp:5173`, from the emulator or a phone on USB).
 */
public class ShardsHost {

    static final String VM_ORIGIN = "https://35-206-75-121.sslip.io";
    static final String DEV_ORIGIN = "http://localhost:5173";
    private static final String PREFS = "shards";
    private static final String KEY_SERVER = "server";

    private final SharedPreferences prefs;
    private volatile String phase = "offline";

    ShardsHost(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
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
}

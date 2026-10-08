package net.meridianshards.client;

import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Answers https://localhost/assets/<name>?v=<hash> from the selected server's /assets/, so the
 * page asks for the game files exactly as in the browser and on the desktop
 * (apps/client/src/assets.ts). Everything else is Capacitor's: the client build from the APK.
 *
 * For now every file comes from the server; ADR 0003 phase 2 adds what the desktop's
 * apps/desktop/src/assetCache.ts does: the files bundled with the app, a cache checked
 * against the manifest's hashes, and downloading everything ahead.
 */
public class ShardsWebViewClient extends BridgeWebViewClient {

    private static final String TAG = "ShardsAssets";
    private static final String PREFIX = "/assets/";
    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("json", "application/json");
        MIME.put("bmp", "image/bmp");
        MIME.put("png", "image/png");
        MIME.put("ico", "image/x-icon");
        MIME.put("ttf", "font/ttf");
        MIME.put("ogg", "audio/ogg");
        MIME.put("wav", "audio/wav");
        MIME.put("mp3", "audio/mpeg");
    }

    private final Bridge bridge;
    private final ShardsHost host;

    ShardsWebViewClient(Bridge bridge, ShardsHost host) {
        super(bridge);
        this.bridge = bridge;
        this.host = host;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        if (
            "GET".equals(request.getMethod()) &&
            bridge.getHost().equalsIgnoreCase(url.getHost()) &&
            path != null &&
            path.startsWith(PREFIX)
        ) return asset(path.substring(PREFIX.length()), url.getQuery());
        return super.shouldInterceptRequest(view, request);
    }

    /** A relative asset path with no way out of its folder (assetCache.ts safeName). */
    private static boolean safe(String name) {
        if (name.isEmpty() || name.contains("\\")) return false;
        for (String part : name.split("/", -1)) if (part.isEmpty() || part.equals(".") || part.equals("..")) return false;
        return true;
    }

    private static String mimeOf(String name) {
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String type = MIME.get(ext);
        return type != null ? type : "application/octet-stream";
    }

    // Runs on the WebView's network thread, so it may block
    private WebResourceResponse asset(String name, String query) {
        if (!safe(name)) return failure(400, "Bad Request", "bad asset name");
        String remote = host.server() + PREFIX + Uri.encode(name, "/") + (query != null ? "?" + query : "");
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(remote).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            // The manifest must always be fresh; hashed files are cached by the page itself
            conn.setUseCaches(false);
            int status = conn.getResponseCode();
            if (status != 200) {
                Log.w(TAG, remote + ": HTTP " + status);
                conn.disconnect();
                return failure(status, "Error", remote + ": HTTP " + status);
            }
            InputStream body = conn.getInputStream();
            Map<String, String> headers = new HashMap<>();
            long length = conn.getContentLengthLong();
            if (length >= 0) headers.put("Content-Length", String.valueOf(length));
            return new WebResourceResponse(mimeOf(name), null, 200, "OK", headers, body);
        } catch (IOException e) {
            Log.w(TAG, remote + ": " + e.getMessage());
            return failure(502, "Bad Gateway", String.valueOf(e.getMessage()));
        }
    }

    private static WebResourceResponse failure(int status, String reason, String text) {
        return new WebResourceResponse(
            "text/plain",
            "utf-8",
            status,
            reason,
            new HashMap<>(),
            new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8))
        );
    }
}

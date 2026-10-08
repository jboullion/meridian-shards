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
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Answers https://localhost/assets/<name>?v=<hash> through AssetCache (the APK, the cache, then
 * the selected server), so the page asks for the game files exactly as in the browser and on
 * the desktop (apps/client/src/assets.ts). Everything else is Capacitor's: the client build
 * from the APK.
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
    private final AssetCache assets;

    ShardsWebViewClient(Bridge bridge, ShardsHost host, AssetCache assets) {
        super(bridge);
        this.bridge = bridge;
        this.host = host;
        this.assets = assets;
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
        ) return asset(path.substring(PREFIX.length()), url.getQueryParameter("v"));
        return super.shouldInterceptRequest(view, request);
    }

    private static String mimeOf(String name) {
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String type = MIME.get(ext);
        return type != null ? type : "application/octet-stream";
    }

    // Runs on the WebView's network thread, so it may block
    private WebResourceResponse asset(String name, String hash) {
        if (!AssetCache.safe(name)) return failure(400, "Bad Request", "bad asset name");
        try {
            AssetCache.Source src = assets.open(host.server(), name, hash);
            Map<String, String> headers = new HashMap<>();
            if (src.length >= 0) headers.put("Content-Length", String.valueOf(src.length));
            return new WebResourceResponse(mimeOf(name), null, 200, "OK", headers, src.stream);
        } catch (IOException e) {
            Log.w(TAG, name + ": " + e.getMessage());
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

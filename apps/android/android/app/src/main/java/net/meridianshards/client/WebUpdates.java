package net.meridianshards.client;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import com.getcapacitor.Bridge;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;

/**
 * Updates of the page without a new APK (ours, ADR 0003). The page is the client build (about
 * 1 MB); a release also carries it as Meridian-Shards-web-<version>-shell<n>.zip
 * (tools/android/web-bundle.ts). The page finds a newer one (host.ts androidBridge) and asks for
 * it; it's downloaded, checked against its SHA-256 and its bundle.json, and unpacked into
 * filesDir/web/<version>. It runs from Capacitor's own saved server path (CapWebViewSettings
 * serverBasePath, which Capacitor reads when it loads the page and clears when a new APK is
 * installed), on "Restart to update" or at the next start.
 *
 * A bundle needs the shell (this app's native side) to be at least the version it was built
 * with (bundle.json shell, apps/android/shell.json): a newer page may call things an older shell
 * hasn't got. Then only a new APK will do.
 *
 * A bundle that's started but never confirmed (the page calls confirm a few seconds after it
 * runs) is given up at the next start: the page that ran before comes back, and that version
 * isn't downloaded again (the page offers the APK instead).
 */
final class WebUpdates {

    private static final String TAG = "ShardsWeb";
    private static final String PREFS = "shards.web";
    /** A downloaded bundle's version, ready to start */
    private static final String KEY_PENDING = "pending";
    /** The bundle started but not yet confirmed: its directory */
    private static final String KEY_TRYING = "trying";
    /** While trying: the page served before it ("" for the APK's own), to go back to */
    private static final String KEY_PREVIOUS = "previous";
    /** A version that started and never confirmed: not again */
    private static final String KEY_FAILED = "failed";
    /** Capacitor's: Bridge.loadWebView reads it, Bridge.isNewBinary clears it */
    private static final String CAP_PREFS = "CapWebViewSettings";
    private static final String CAP_SERVER_PATH = "serverBasePath";

    private WebUpdates() {}

    static File root(Context context) {
        return new File(context.getFilesDir(), "web");
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SharedPreferences cap(Context context) {
        return context.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE);
    }

    /** Whether version a (x.y.z) is newer than b (host.ts newerVersion). */
    static boolean newer(String a, String b) {
        String[] pa = a.split("\\."), pb = b.split("\\.");
        for (int i = 0; i < 3; i++) {
            int x = i < pa.length ? parse(pa[i]) : 0, y = i < pb.length ? parse(pb[i]) : 0;
            if (x != y) return x > y;
        }
        return false;
    }

    private static int parse(String s) {
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /**
     * Before Capacitor loads the page (ShardsPlugin.load runs first): give up a bundle that was
     * started and never confirmed; start a downloaded one; and remove bundles no longer in use.
     */
    static void beforeLoad(Context context) {
        SharedPreferences ours = prefs(context);
        SharedPreferences cap = cap(context);
        String trying = ours.getString(KEY_TRYING, null);
        if (trying != null) {
            // It never said it worked: back to the page before it, if that's still newer than the APK's
            String previous = ours.getString(KEY_PREVIOUS, "");
            boolean keep = !previous.isEmpty() && new File(previous, "index.html").isFile() && newer(new File(previous).getName(), BuildConfig.VERSION_NAME);
            Log.w(TAG, "the page from " + trying + " never confirmed; going back to " + (keep ? previous : "the app's own"));
            cap.edit().putString(CAP_SERVER_PATH, keep ? previous : "").apply();
            deleteTree(new File(trying));
            ours.edit().remove(KEY_TRYING).remove(KEY_PREVIOUS).remove(KEY_PENDING).putString(KEY_FAILED, new File(trying).getName()).apply();
        } else {
            String pending = ours.getString(KEY_PENDING, null);
            File dir = pending != null ? new File(root(context), pending) : null;
            if (dir != null && new File(dir, "index.html").isFile() && newer(pending, BuildConfig.VERSION_NAME)) start(context, dir);
            else if (pending != null) ours.edit().remove(KEY_PENDING).apply();
        }
        cleanup(context);
    }

    /** Make `dir` the page Capacitor serves, to be confirmed once it runs. */
    private static void start(Context context, File dir) {
        String previous = cap(context).getString(CAP_SERVER_PATH, "");
        cap(context).edit().putString(CAP_SERVER_PATH, dir.getAbsolutePath()).apply();
        prefs(context).edit().putString(KEY_TRYING, dir.getAbsolutePath()).putString(KEY_PREVIOUS, previous).remove(KEY_PENDING).apply();
        Log.i(TAG, "starting the page from " + dir);
    }

    /** "Restart to update": the downloaded bundle now, by reloading the page from it. False if there's none. */
    static boolean applyNow(Context context, Bridge bridge) {
        String pending = prefs(context).getString(KEY_PENDING, null);
        if (pending == null) return false;
        File dir = new File(root(context), pending);
        if (!new File(dir, "index.html").isFile()) return false;
        start(context, dir);
        bridge.setServerBasePath(dir.getAbsolutePath());
        return true;
    }

    /** The page runs: keep it, and drop the others. */
    static void confirm(Context context) {
        SharedPreferences ours = prefs(context);
        if (ours.getString(KEY_TRYING, null) == null) return;
        ours.edit().remove(KEY_TRYING).remove(KEY_PREVIOUS).apply();
        Log.i(TAG, "the page from " + cap(context).getString(CAP_SERVER_PATH, "") + " runs");
        cleanup(context);
    }

    /** Remove every bundle but the one served, the one waiting and the one to go back to. */
    private static void cleanup(Context context) {
        File[] dirs = root(context).listFiles();
        if (dirs == null) return;
        String served = cap(context).getString(CAP_SERVER_PATH, "");
        String pending = prefs(context).getString(KEY_PENDING, null);
        String previous = prefs(context).getString(KEY_PREVIOUS, "");
        for (File d : dirs) {
            String path = d.getAbsolutePath();
            if (path.equals(served) || path.equals(previous) || d.getName().equals(pending)) continue;
            deleteTree(d);
        }
    }

    /** What happened, for the page (window.shardsAndroidWebUpdate) */
    interface Report {
        void send(String json);
    }

    /**
     * Downloads the bundle at `url` (a release's -web zip), checks it (`sha256` from GitHub,
     * when it's given; bundle.json's version and shell) and unpacks it, ready for the next start.
     * Off the main thread.
     */
    static void download(Context context, String url, String version, String sha256, Report report) {
        new Thread(
            () -> {
                File zip = new File(context.getCacheDir(), "web-" + version + ".zip");
                File part = new File(root(context), version + ".part");
                File dir = new File(root(context), version);
                try {
                    if (!version.matches("\\d+\\.\\d+\\.\\d+")) throw new IOException("bad version " + version);
                    if (version.equals(prefs(context).getString(KEY_FAILED, null))) throw new IOException("it didn't start last time");
                    String got = fetch(url, zip);
                    if (sha256 != null && !sha256.isEmpty() && !sha256.equalsIgnoreCase(got)) throw new IOException("the download's SHA-256 doesn't match");
                    deleteTree(part);
                    unzip(zip, part);
                    JSONObject bundle = new JSONObject(readText(new File(part, "bundle.json")));
                    if (!version.equals(bundle.optString("version"))) throw new IOException("bundle.json is for " + bundle.optString("version"));
                    int shell = bundle.optInt("shell", Integer.MAX_VALUE);
                    if (shell > BuildConfig.SHELL) throw new IOException("it needs shell " + shell + ", this app is " + BuildConfig.SHELL);
                    if (!new File(part, "index.html").isFile()) throw new IOException("no index.html");
                    deleteTree(dir);
                    if (!part.renameTo(dir)) throw new IOException("can't move it into place");
                    prefs(context).edit().putString(KEY_PENDING, version).apply();
                    Log.i(TAG, "version " + version + " is ready");
                    report.send(new JSONObject().put("state", "ready").put("version", version).toString());
                } catch (Exception e) {
                    Log.w(TAG, "version " + version + ": " + e.getMessage());
                    deleteTree(part);
                    try {
                        report.send(new JSONObject().put("state", "error").put("version", version).put("message", String.valueOf(e.getMessage())).toString());
                    } catch (Exception ignored) {
                        // nothing to tell
                    }
                } finally {
                    //noinspection ResultOfMethodCallIgnored
                    zip.delete();
                }
            },
            "shards-web-update"
        ).start();
    }

    /** Downloads `url` into `to` (following redirects, as GitHub's go elsewhere); returns its SHA-256 in hex. */
    private static String fetch(String url, File to) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        int status = c.getResponseCode();
        if (status != 200) throw new IOException("HTTP " + status);
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(c.getInputStream()); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[65536];
            for (int n; (n = in.read(buf)) > 0; ) {
                sha.update(buf, 0, n);
                out.write(buf, 0, n);
            }
        } finally {
            c.disconnect();
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : sha.digest()) hex.append(String.format("%02x", b));
        return hex.toString();
    }

    /** Unpacks `zip` into `into`, refusing names that would land outside it. */
    private static void unzip(File zip, File into) throws IOException {
        if (!into.mkdirs() && !into.isDirectory()) throw new IOException("can't make " + into);
        String base = into.getCanonicalPath() + File.separator;
        try (ZipInputStream in = new ZipInputStream(new BufferedInputStream(new FileInputStream(zip)))) {
            byte[] buf = new byte[65536];
            for (ZipEntry e; (e = in.getNextEntry()) != null; ) {
                File f = new File(into, e.getName());
                if (!f.getCanonicalPath().startsWith(base)) throw new IOException("bad name " + e.getName());
                if (e.isDirectory()) {
                    //noinspection ResultOfMethodCallIgnored
                    f.mkdirs();
                    continue;
                }
                File parent = f.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("can't make " + parent);
                try (OutputStream out = new FileOutputStream(f)) {
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                }
            }
        }
    }

    private static String readText(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            byte[] all = new byte[(int) f.length()];
            int off = 0;
            for (int n; off < all.length && (n = in.read(all, off, all.length - off)) > 0; ) off += n;
            return new String(all, 0, off, StandardCharsets.UTF_8);
        }
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}

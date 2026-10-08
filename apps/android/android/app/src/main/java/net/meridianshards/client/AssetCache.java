package net.meridianshards.client;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The game files for https://localhost/assets/*: the Android side of the desktop's
 * apps/desktop/src/assetCache.ts, with the same rules. The page asks for
 * /assets/<name>?v=<hash> (apps/client/src/assets.ts); a file comes from the APK when its hash
 * there matches (release builds carry the asset build, dist/assets, as the APK's assets/assets/, with its manifest), else
 * from filesDir/asset-cache/<name>.<hash>, else from the selected server's /assets/, checked
 * against the hash (the first 16 hex digits of the SHA-1) before it's kept. manifest.json, and
 * anything asked for without a hash, always comes from the server.
 *
 * downloadAll() fetches every file the server lists that's in neither place yet, and after a
 * complete pass deletes cached versions the server no longer lists.
 */
public class AssetCache {

    private static final String TAG = "ShardsAssets";
    /** The asset build inside the APK: dist/assets, which app/build.gradle adds to release builds */
    private static final String BUNDLE = "assets";
    /** Files needed first come first: the resources, rooms, then sprites and textures, then sound */
    private static final String[] ORDER = { ".rsb", ".json", ".bin", ".ttf", ".bmp", ".ico", ".roo", ".bgf", ".bsf", ".ogg", ".wav", ".mp3" };
    /** Downloads at once: enough to hide the latency to a far server */
    private static final int PARALLEL = 8;
    private static final Pattern HASH = Pattern.compile("^[0-9a-f]{16}$");
    /** A temporary file this old is from a download that never finished (the app was killed) */
    private static final long STALE_TMP_MS = 10 * 60 * 1000;

    /** Stops a downloadAll() run (the server changed, or a newer run started). */
    static final class Run {

        final String origin;
        volatile boolean cancelled;
        volatile boolean finished;

        Run(String origin) {
            this.origin = origin;
        }
    }

    interface ProgressListener {
        /** host.ts DesktopAssetProgress as JSON */
        void onProgress(String json);
    }

    /** Where a file's bytes come from, with its length when known (-1 otherwise). */
    static final class Source {

        final InputStream stream;
        final long length;

        Source(InputStream stream, long length) {
            this.stream = stream;
            this.length = length;
        }
    }

    private final File root;
    private final AssetManager apk;
    private final Map<String, String> bundled = new HashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<byte[]>> inflight = new ConcurrentHashMap<>();
    private final AtomicInteger fromApk = new AtomicInteger();
    private final AtomicInteger fromCache = new AtomicInteger();
    private final AtomicInteger downloads = new AtomicInteger();

    private static AssetCache instance;

    /** One per process: Android can create the activity (and the plugin) more than once. */
    static synchronized AssetCache get(Context context) {
        if (instance == null) instance = new AssetCache(new File(context.getFilesDir(), "asset-cache"), context.getApplicationContext().getAssets());
        return instance;
    }

    private AssetCache(File root, AssetManager apk) {
        this.root = root;
        this.apk = apk;
        try (InputStream in = apk.open(BUNDLE + "/manifest.json")) {
            JSONObject files = new JSONObject(new String(readAll(in), StandardCharsets.UTF_8)).getJSONObject("files");
            for (Iterator<String> it = files.keys(); it.hasNext();) {
                String name = it.next();
                bundled.put(name, files.getJSONObject(name).getString("hash"));
            }
            Log.i(TAG, bundled.size() + " files packaged with the app");
        } catch (IOException | JSONException e) {
            Log.i(TAG, "no packaged files (" + e.getMessage() + ")");
        }
    }

    /** A relative asset path with no way out of its folder (assetCache.ts safeName). */
    static boolean safe(String name) {
        if (name.isEmpty() || name.contains("\\")) return false;
        for (String part : name.split("/", -1)) if (part.isEmpty() || part.equals(".") || part.equals("..")) return false;
        return true;
    }

    static boolean isHash(String hash) {
        return hash != null && HASH.matcher(hash).matches();
    }

    private File fileOf(String name, String hash) {
        return new File(root, name.replace('/', File.separatorChar) + "." + hash);
    }

    private static String remote(String origin, String name, String hash) {
        return origin + "/assets/" + name + (hash != null ? "?v=" + hash : "");
    }

    /**
     * Answers /assets/<name>?v=<hash> from `origin`'s files. A file without a content hash (the
     * manifest) comes straight from the server and isn't kept.
     */
    Source open(String origin, String name, String hash) throws IOException {
        if (!isHash(hash)) return passThrough(remote(origin, name, hash));
        if (hash.equals(bundled.get(name))) {
            try {
                InputStream in = apk.open(BUNDLE + "/" + name);
                fromApk.incrementAndGet();
                return new Source(in, -1);
            } catch (IOException e) {
                // missing from the APK after all: try the cache, then the server
            }
        }
        File f = fileOf(name, hash);
        if (f.isFile()) {
            fromCache.incrementAndGet();
            return new Source(new FileInputStream(f), f.length());
        }
        byte[] bytes = fetch(name, hash, remote(origin, name, hash));
        return new Source(new ByteArrayInputStream(bytes), bytes.length);
    }

    private Source passThrough(String url) throws IOException {
        HttpURLConnection conn = connect(url);
        return new Source(conn.getInputStream(), conn.getContentLengthLong());
    }

    private static HttpURLConnection connect(String url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        // This is the cache; the manifest must always be fresh
        conn.setUseCaches(false);
        int status = conn.getResponseCode();
        if (status != 200) {
            conn.disconnect();
            throw new IOException(url + ": HTTP " + status);
        }
        return conn;
    }

    /** Downloads a file once however many ask for it at the same time, keeping it if its hash checks out. */
    private byte[] fetch(String name, String hash, String url) throws IOException {
        String key = fileOf(name, hash).getPath();
        CompletableFuture<byte[]> mine = new CompletableFuture<>();
        CompletableFuture<byte[]> running = inflight.putIfAbsent(key, mine);
        if (running != null) {
            try {
                return running.get();
            } catch (Exception e) {
                throw new IOException(e.getCause() != null ? e.getCause().getMessage() : e.getMessage());
            }
        }
        try {
            HttpURLConnection conn = connect(url);
            byte[] bytes;
            try (InputStream in = conn.getInputStream()) {
                bytes = readAll(in);
            }
            downloads.incrementAndGet();
            String actual = sha1(bytes).substring(0, 16);
            if (actual.equals(hash)) store(fileOf(name, hash), bytes);
            else Log.w(TAG, name + " hashes to " + actual + ", not " + hash + "; not caching it");
            mine.complete(bytes);
            return bytes;
        } catch (IOException e) {
            mine.completeExceptionally(e);
            throw e;
        } finally {
            inflight.remove(key);
        }
    }

    /** Written to a temporary name and renamed, so a crash never leaves half a file. */
    private void store(File f, byte[] bytes) {
        File dir = f.getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) {
            Log.w(TAG, "can't make " + dir);
            return;
        }
        File tmp = new File(f.getPath() + "." + UUID.randomUUID() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(bytes);
        } catch (IOException e) {
            Log.w(TAG, "can't cache " + f + ": " + e.getMessage());
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            return;
        }
        if (!tmp.renameTo(f)) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
    }

    private static int rank(String name) {
        String ext = name.substring(Math.max(0, name.lastIndexOf('.'))).toLowerCase(Locale.ROOT);
        for (int i = 0; i < ORDER.length; i++) if (ORDER[i].equals(ext)) return i;
        return ORDER.length;
    }

    /**
     * Downloads every file in `run.origin`'s manifest that isn't in the APK or the cache yet,
     * PARALLEL at a time, reporting progress (by bytes, counting what's already there) a few
     * times a second. Blocks; call it on a thread of its own.
     */
    void downloadAll(Run run, ProgressListener listener) {
        final String[] state = { "checking" };
        final AtomicLong doneBytes = new AtomicLong();
        final long[] totalBytes = { 0 };
        final AtomicInteger fetched = new AtomicInteger();
        final AtomicInteger failed = new AtomicInteger();
        final long[] sent = { 0 };
        final Object lock = new Object();
        Runnable emit = () -> {
            if (run.cancelled) return;
            try {
                listener.onProgress(
                    new JSONObject()
                        .put("state", state[0])
                        .put("doneBytes", doneBytes.get())
                        .put("totalBytes", totalBytes[0])
                        .put("fetched", fetched.get())
                        .put("failed", failed.get())
                        .toString()
                );
            } catch (JSONException e) {
                throw new IllegalStateException(e);
            }
        };
        emit.run();

        JSONObject files;
        try {
            HttpURLConnection conn = connect(run.origin + "/assets/manifest.json");
            try (InputStream in = conn.getInputStream()) {
                files = new JSONObject(new String(readAll(in), StandardCharsets.UTF_8)).getJSONObject("files");
            }
        } catch (IOException | JSONException e) {
            Log.w(TAG, "can't read " + run.origin + "'s manifest: " + e.getMessage());
            state[0] = "error";
            failed.set(1);
            emit.run();
            return;
        }

        Set<String> keep = new HashSet<>();
        List<String[]> missing = new ArrayList<>();
        Map<String, Long> sizes = new HashMap<>();
        for (Iterator<String> it = files.keys(); it.hasNext();) {
            String name = it.next();
            JSONObject f = files.optJSONObject(name);
            if (f == null) continue;
            String hash = f.optString("hash");
            long size = f.optLong("size");
            if (!safe(name) || !isHash(hash)) continue;
            totalBytes[0] += size;
            sizes.put(name, size);
            // A cached copy of a file the APK has (left by an older install) goes in the prune
            if (hash.equals(bundled.get(name))) doneBytes.addAndGet(size);
            else {
                keep.add(fileOf(name, hash).getPath());
                if (fileOf(name, hash).isFile()) doneBytes.addAndGet(size);
                else missing.add(new String[] { name, hash });
            }
        }
        missing.sort((a, b) -> rank(a[0]) != rank(b[0]) ? rank(a[0]) - rank(b[0]) : a[0].compareTo(b[0]));
        state[0] = missing.isEmpty() ? "done" : "downloading";
        if (!missing.isEmpty()) Log.i(TAG, "downloading " + missing.size() + " files (" + (totalBytes[0] - doneBytes.get()) / (1 << 20) + " MB) from " + run.origin);
        emit.run();

        ConcurrentLinkedQueue<String[]> queue = new ConcurrentLinkedQueue<>(missing);
        CountDownLatch workers = new CountDownLatch(PARALLEL);
        for (int i = 0; i < PARALLEL; i++) {
            new Thread(
                () -> {
                    try {
                        for (String[] next = queue.poll(); next != null && !run.cancelled; next = queue.poll()) {
                            String name = next[0], hash = next[1];
                            try {
                                if (!fileOf(name, hash).isFile()) fetch(name, hash, remote(run.origin, name, hash));
                                doneBytes.addAndGet(sizes.get(name));
                                fetched.incrementAndGet();
                            } catch (IOException e) {
                                failed.incrementAndGet();
                                Log.w(TAG, name + ": " + e.getMessage());
                            }
                            synchronized (lock) {
                                long now = System.currentTimeMillis();
                                if (now - sent[0] >= 250) {
                                    sent[0] = now;
                                    emit.run();
                                }
                            }
                        }
                    } finally {
                        workers.countDown();
                    }
                },
                "shards-assets-" + i
            ).start();
        }
        try {
            workers.await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return;
        }
        if (run.cancelled) return;
        state[0] = failed.get() > 0 ? "error" : "done";
        if (failed.get() > 0) Log.w(TAG, failed.get() + " files failed; they'll load as they're needed");
        else prune(keep);
        Log.i(TAG, report());
        emit.run();
    }

    /** Deletes cached files that aren't in `keep` (versions an update replaced) and empty folders. */
    private void prune(Set<String> keep) {
        int[] removed = { 0 };
        pruneDir(root, keep, removed);
        if (removed[0] > 0) Log.i(TAG, "removed " + removed[0] + " outdated files");
    }

    private void pruneDir(File dir, Set<String> keep, int[] removed) {
        File[] list = dir.listFiles();
        if (list == null) return;
        for (File f : list) {
            if (f.isDirectory()) {
                pruneDir(f, keep, removed);
                //noinspection ResultOfMethodCallIgnored
                f.delete(); // only succeeds when empty
            } else if (f.getName().endsWith(".tmp")) {
                // Half a download: still being written, or left by a process that was killed
                if (System.currentTimeMillis() - f.lastModified() > STALE_TMP_MS && f.delete()) removed[0]++;
            } else if (!keep.contains(f.getPath()) && !inflight.containsKey(f.getPath())) {
                if (f.delete()) removed[0]++;
            }
        }
    }

    String report() {
        return fromApk.get() + " from the APK, " + fromCache.get() + " from the cache, " + downloads.get() + " downloaded";
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        for (int n; (n = in.read(buf)) > 0;) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static String sha1(byte[] bytes) {
        try {
            StringBuilder hex = new StringBuilder();
            for (byte b : MessageDigest.getInstance("SHA-1").digest(bytes)) hex.append(String.format(Locale.ROOT, "%02x", b));
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}

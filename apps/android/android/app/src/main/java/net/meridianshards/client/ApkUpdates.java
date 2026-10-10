package net.meridianshards.client;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.FileProvider;
import java.io.File;
import org.json.JSONObject;

/**
 * A new APK, when the page can't be updated by itself (WebUpdates: the release needs a newer
 * shell). Ours, ADR 0003: the phone's browser used to download it, and Chrome's in-app tab
 * stopped at 100% waiting for an APK warning it never showed. Now Android's DownloadManager
 * fetches it into the app's own downloads folder (no storage permission; a notification shows
 * the progress), and Android's installer opens on it. Sideloading needs "Install unknown apps"
 * for this app once: without it, the settings page for it opens first, and the page offers
 * Install again.
 */
final class ApkUpdates {

    private static final String TAG = "ShardsApk";
    private static final String MIME = "application/vnd.android.package-archive";

    /** The download in progress (one at a time, per process) and the file it's for */
    private static long downloadId = -1;
    private static File file;

    private ApkUpdates() {}

    interface Report {
        void send(String json);
    }

    private static File fileFor(Context context, String version) {
        return new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Meridian-Shards-" + version + ".apk");
    }

    /** Starts downloading the APK at `url`; progress and the outcome go to `report`, then the installer opens. */
    static synchronized void download(Context context, String url, String version, Report report) {
        if (!version.matches("\\d+\\.\\d+\\.\\d+")) return;
        DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) return;
        if (downloadId >= 0) dm.remove(downloadId);
        file = fileFor(context, version);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url))
            .setTitle("Meridian Shards " + version)
            .setDescription("The update")
            .setMimeType(MIME)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, file.getName());
        long id = dm.enqueue(req);
        downloadId = id;
        File target = file;
        new Thread(() -> follow(context, dm, id, target, version, report), "shards-apk").start();
    }

    /** Polls the download for the page until it ends; then opens the installer. */
    private static void follow(Context context, DownloadManager dm, long id, File target, String version, Report report) {
        try {
            while (true) {
                long done = 0, total = -1;
                int status;
                try (Cursor c = dm.query(new DownloadManager.Query().setFilterById(id))) {
                    if (c == null || !c.moveToFirst()) {
                        send(report, "error", version, 0, -1, "the download was cancelled");
                        return;
                    }
                    status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                    total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                }
                if (status == DownloadManager.STATUS_SUCCESSFUL) {
                    send(report, "downloaded", version, done, total, null);
                    install(context, report, version);
                    return;
                }
                if (status == DownloadManager.STATUS_FAILED) {
                    send(report, "error", version, done, total, "the download failed");
                    return;
                }
                send(report, "downloading", version, done, total, null);
                Thread.sleep(500);
            }
        } catch (Exception e) {
            Log.w(TAG, "following the download: " + e.getMessage());
            send(report, "error", version, 0, -1, String.valueOf(e.getMessage()));
        }
    }

    /**
     * Opens Android's installer on the downloaded APK, or first the setting that lets this app
     * install apps (the page then offers Install again). False if there's nothing downloaded.
     */
    static boolean install(Context context, Report report, String version) {
        File apk = file;
        if (apk == null || !apk.isFile()) return false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.getPackageManager().canRequestPackageInstalls()) {
                Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
                allow.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(allow);
                send(report, "permission", version, apk.length(), apk.length(), null);
                return true;
            }
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
            Intent open = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, MIME);
            open.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(open);
            send(report, "installing", version, apk.length(), apk.length(), null);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "opening the installer: " + e.getMessage());
            send(report, "error", version, 0, -1, String.valueOf(e.getMessage()));
            return false;
        }
    }

    private static void send(Report report, String state, String version, long done, long total, String message) {
        try {
            JSONObject o = new JSONObject().put("state", state).put("version", version).put("done", done).put("total", total);
            if (message != null) o.put("message", message);
            report.send(o.toString());
        } catch (Exception ignored) {
            // nothing to tell
        }
    }
}

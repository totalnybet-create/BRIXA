package pl.siedlar.zipinstaller;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.widget.Toast;

public class InstallResultReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm;
            if (android.os.Build.VERSION.SDK_INT >= 33) confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
            else {
                @SuppressWarnings("deprecation") Intent legacy = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                confirm = legacy;
            }
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(confirm);
            }
            return;
        }
        if (status == PackageInstaller.STATUS_SUCCESS) Toast.makeText(context, "Aplikacja zainstalowana", Toast.LENGTH_LONG).show();
        else Toast.makeText(context, "Instalacja nieudana" + (message == null ? "" : ": " + message), Toast.LENGTH_LONG).show();
    }
}

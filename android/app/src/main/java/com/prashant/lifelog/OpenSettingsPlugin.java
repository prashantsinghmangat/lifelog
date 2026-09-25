package com.prashant.lifelog;

import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * One method: hand the OS its own notification-channel screen.
 *
 * Once a channel exists its sound and vibration are Android's to change, not
 * this app's — there is no API for either, only a deep link to the settings
 * screen that can. Below Android 8 there are no channels at all, so the
 * app-level notification settings are the closest equivalent.
 */
@CapacitorPlugin(name = "OpenSettings")
public class OpenSettingsPlugin extends Plugin {

    @PluginMethod
    public void openNotificationChannel(PluginCall call) {
        String channelId = call.getString("channelId");
        if (channelId == null) {
            call.reject("channelId is required");
            return;
        }

        Intent intent = new Intent();
        String packageName = getContext().getPackageName();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent.setAction(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, packageName);
            intent.putExtra(Settings.EXTRA_CHANNEL_ID, channelId);
        } else {
            intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, packageName);
        }
        getContext().startActivity(intent);
        call.resolve(new JSObject());
    }
}

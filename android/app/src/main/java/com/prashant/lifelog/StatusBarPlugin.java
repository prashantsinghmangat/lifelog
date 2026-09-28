package com.prashant.lifelog;

import android.app.Activity;
import android.view.Window;

import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * One method: paint the status bar to match the app's own theme, not the
 * OS's. The You screen lets the two disagree, so this cannot use `@color/
 * surface` the way the splash and window background do — that resource
 * follows the system's night qualifier, and would get it backwards the
 * moment someone picks a theme that disagrees with the OS. `surface_light`
 * / `surface_dark` are fixed for exactly that reason.
 *
 * Deliberately opaque, never edge-to-edge: ARCHITECTURE.md records that the
 * safe-area insets read 0 on this device class, so a transparent bar would
 * put the header under the clock.
 */
@CapacitorPlugin(name = "StatusBarPlugin")
public class StatusBarPlugin extends Plugin {

    @PluginMethod
    public void setStyle(PluginCall call) {
        boolean dark = call.getBoolean("dark", false);
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve(new JSObject());
            return;
        }

        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            int colorRes = dark ? R.color.surface_dark : R.color.surface_light;
            window.setStatusBarColor(ContextCompat.getColor(activity, colorRes));

            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
            // A light backdrop needs dark icons to stay legible, and the reverse.
            controller.setAppearanceLightStatusBars(!dark);
        });

        call.resolve(new JSObject());
    }
}

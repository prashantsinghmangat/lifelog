package com.prashant.lifelog;

import android.app.Activity;
import android.graphics.Color;
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
        // The resolved palette's surface, sent from JS since spec 015 — the
        // bar follows the palette as well as the mode, which the two fixed
        // resources below never could. They stay as the fallback for a call
        // that carries no colour, or one that does not parse.
        String color = call.getString("color", null);
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve(new JSObject());
            return;
        }

        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            int painted;
            try {
                painted = Color.parseColor(color);
            } catch (Exception invalid) {
                int colorRes = dark ? R.color.surface_dark : R.color.surface_light;
                painted = ContextCompat.getColor(activity, colorRes);
            }
            window.setStatusBarColor(painted);

            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
            // A light backdrop needs dark icons to stay legible, and the reverse.
            controller.setAppearanceLightStatusBars(!dark);
        });

        call.resolve(new JSObject());
    }
}

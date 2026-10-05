package com.prashant.lifelog;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Text shared into lifelog from another app, held until the WebView asks.
 *
 * Most of what gets logged starts somewhere else — a UPI confirmation, a line
 * in a chat — and retyping it is the part of capture that is not five seconds.
 * Capacitor forwards URLs through `appUrlOpen` but has nothing for
 * `ACTION_SEND`, so the intent is read here and parked.
 *
 * Parked rather than pushed, because the WebView may not exist yet: a cold
 * share starts the activity, and the bridge is built after `onCreate` has
 * already seen the intent. So the text waits for the first `take`, and
 * `take` hands it over exactly once — a resume must never re-deliver a share
 * the box already has.
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    /** Static because the activity reads the launch intent before the plugin is instantiated. */
    private static String pending = null;

    /**
     * Called from `MainActivity` for both the launching intent and every later
     * one. Anything that is not a plain-text send is ignored rather than
     * guessed at — the manifest only claims `text/plain`, and a share of
     * something else arriving here would mean the filter was widened without
     * this being revisited.
     */
    static void offer(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return;

        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null) return;

        String trimmed = text.toString().trim();
        if (trimmed.isEmpty()) return;

        // The newest share wins. Sharing twice before opening the app means the
        // second one is what the reader is looking at, and a queue would put
        // the forgotten one in the box first.
        pending = trimmed;
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject result = new JSObject();
        result.put("text", pending);
        pending = null;
        call.resolve(result);
    }
}

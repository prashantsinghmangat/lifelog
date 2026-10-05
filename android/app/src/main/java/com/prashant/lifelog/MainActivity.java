package com.prashant.lifelog;

import android.content.Intent;
import android.os.Bundle;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must come before super.onCreate() — that is what actually shows the
        // splash theme's window as a real, dismissible splash screen rather
        // than just a themed background behind the activity.
        SplashScreen.installSplashScreen(this);
        // Registered before the bridge exists, which is what `super.onCreate`
        // builds — after it, this plugin would simply be missing.
        registerPlugin(OpenSettingsPlugin.class);
        registerPlugin(StatusBarPlugin.class);
        registerPlugin(ShareTargetPlugin.class);
        super.onCreate(savedInstanceState);

        // Read after the bridge is built but from the intent that started this
        // activity: a cold share arrives here, and nothing in the WebView is
        // listening yet when it does.
        ShareTargetPlugin.offer(getIntent());
    }

    /**
     * A share into an already-running lifelog. Without this the activity keeps
     * the intent it was launched with for ever and every share after the first
     * is silently dropped.
     */
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        ShareTargetPlugin.offer(intent);
    }
}

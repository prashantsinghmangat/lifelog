package com.prashant.lifelog;

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
        super.onCreate(savedInstanceState);
    }
}

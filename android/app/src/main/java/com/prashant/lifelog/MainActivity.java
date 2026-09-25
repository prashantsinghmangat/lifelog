package com.prashant.lifelog;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before the bridge exists, which is what `super.onCreate`
        // builds — after it, this plugin would simply be missing.
        registerPlugin(OpenSettingsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

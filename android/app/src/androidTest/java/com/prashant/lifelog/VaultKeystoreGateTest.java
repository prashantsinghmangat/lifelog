package com.prashant.lifelog;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Spec 048, Gate 0: can the Android Keystore give the vault a device-bound wrap
 * without ever handing JavaScript a recoverable secret?
 *
 * This is a spike, not production code. It lives in androidTest on purpose —
 * nothing here ships, and the vault's own files may not be written until this
 * has answered. Read the answers out of logcat under the GATE0 tag.
 */
@RunWith(AndroidJUnit4.class)
public class VaultKeystoreGateTest {

    private static final String TAG = "GATE0";
    private static final String STORE = "AndroidKeyStore";
    private static final String ALIAS = "lifelog.vault.gate0";
    private static final String ALIAS_AUTH = "lifelog.vault.gate0.auth";
    private static final String ALIAS_REBOOT = "lifelog.vault.gate0.reboot";
    private static final String TRANSFORM = "AES/GCM/NoPadding";

    private SecretKey generate(String alias, boolean requireAuth, boolean strongbox)
            throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, STORE);
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
                        alias,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256);

        if (requireAuth) {
            spec.setUserAuthenticationRequired(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                spec.setUserAuthenticationParameters(
                        30, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
            }
            // The question behind the vault's "re-enrolment" case: does adding a
            // fingerprint destroy the key, and therefore the vault's daily path?
            spec.setInvalidatedByBiometricEnrollment(true);
        }

        if (strongbox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            spec.setIsStrongBoxBacked(true);
        }

        generator.init(spec.build());
        return generator.generateKey();
    }

    private void drop(String alias) {
        try {
            KeyStore store = KeyStore.getInstance(STORE);
            store.load(null);
            store.deleteEntry(alias);
        } catch (Exception ignored) {
            // A spike cleaning up after itself is not worth failing over.
        }
    }

    /** Q1 + Q2: a hardware-backed key exists, and it can wrap and unwrap a vault key. */
    @Test
    public void generatesHardwareBackedKeyAndWrapsAVaultKey() throws Exception {
        drop(ALIAS);

        SecretKey key;
        boolean strongbox = true;
        try {
            key = generate(ALIAS, false, true);
        } catch (Exception noStrongbox) {
            strongbox = false;
            key = generate(ALIAS, false, false);
        }
        assertNotNull(key);

        SecretKeyFactory factory = SecretKeyFactory.getInstance(key.getAlgorithm(), STORE);
        KeyInfo info = (KeyInfo) factory.getKeySpec(key, KeyInfo.class);

        String level;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            level = String.valueOf(info.getSecurityLevel());
        } else {
            level = info.isInsideSecureHardware() ? "secure-hardware" : "software";
        }

        Log.i(TAG, "Q1 strongbox=" + strongbox + " securityLevel=" + level
                + " sdk=" + Build.VERSION.SDK_INT + " device=" + Build.MODEL);

        // Q2: the thing the daily wrapping actually needs. A 32-byte vault key
        // goes in, ciphertext comes out, and the same bytes come back.
        byte[] vaultKey = new byte[32];
        new SecureRandom().nextBytes(vaultKey);

        Cipher seal = Cipher.getInstance(TRANSFORM);
        seal.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = seal.getIV();
        byte[] wrapped = seal.doFinal(vaultKey);

        Cipher open = Cipher.getInstance(TRANSFORM);
        open.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
        byte[] unwrapped = open.doFinal(wrapped);

        assertArrayEquals(vaultKey, unwrapped);
        assertEquals(12, iv.length);
        assertTrue(wrapped.length > vaultKey.length);

        Log.i(TAG, "Q2 wrap/unwrap=ok ivBytes=" + iv.length + " wrappedBytes=" + wrapped.length);

        // Q5: what would cross the JS boundary. The key itself cannot be
        // exported from the Keystore at all — getEncoded() is null for a
        // hardware-backed key — so only ciphertext and the IV can ever travel.
        Log.i(TAG, "Q5 keyExportable=" + (key.getEncoded() != null)
                + " (null/false means only ciphertext crosses to JS)");
        assertTrue("a Keystore key that can be exported is not device-bound",
                key.getEncoded() == null);

        drop(ALIAS);
    }

    /** Q3: the same key, but usable only after the user has verified. */
    @Test
    public void bindsToUserAuthentication() throws Exception {
        drop(ALIAS_AUTH);

        SecretKey key = generate(ALIAS_AUTH, true, false);
        assertNotNull(key);

        SecretKeyFactory factory = SecretKeyFactory.getInstance(key.getAlgorithm(), STORE);
        KeyInfo info = (KeyInfo) factory.getKeySpec(key, KeyInfo.class);

        Log.i(TAG, "Q3 userAuthRequired=" + info.isUserAuthenticationRequired()
                + " validityDuration=" + info.getUserAuthenticationValidityDurationSeconds()
                + " invalidatedByBiometricEnrollment=true(requested)");

        assertTrue(info.isUserAuthenticationRequired());

        // Whether a cipher init throws UserNotAuthenticatedException here depends
        // on how recently the device was unlocked, so this is recorded rather
        // than asserted — the spike must not fail on a timing-dependent fact.
        String outcome;
        try {
            Cipher seal = Cipher.getInstance(TRANSFORM);
            seal.init(Cipher.ENCRYPT_MODE, key);
            outcome = "usable-without-fresh-auth (device unlocked within the window)";
        } catch (Exception needsAuth) {
            outcome = "refused: " + needsAuth.getClass().getSimpleName();
        }
        Log.i(TAG, "Q3 initWithoutFreshAuth=" + outcome);

        drop(ALIAS_AUTH);
    }

    /**
     * Q4, part one: leave a key behind on purpose, then reboot the phone, then
     * run `verifyKeyAfterReboot`. Run these two by name — running the class
     * seeds and verifies in one go and proves nothing.
     */
    @Test
    public void seedKeyForRebootCheck() throws Exception {
        drop(ALIAS_REBOOT);
        SecretKey key = generate(ALIAS_REBOOT, false, true);

        byte[] payload = new byte[32];
        new SecureRandom().nextBytes(payload);
        Cipher seal = Cipher.getInstance(TRANSFORM);
        seal.init(Cipher.ENCRYPT_MODE, key);
        byte[] wrapped = seal.doFinal(payload);

        // Written where the verify run can read them back: a Keystore key that
        // "exists" after a reboot but cannot open yesterday's ciphertext would
        // pass a weaker check and still lose the vault.
        android.content.Context context =
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
                        .getTargetContext();
        context.getSharedPreferences("gate0", android.content.Context.MODE_PRIVATE)
                .edit()
                .putString("iv", android.util.Base64.encodeToString(seal.getIV(), android.util.Base64.NO_WRAP))
                .putString("wrapped", android.util.Base64.encodeToString(wrapped, android.util.Base64.NO_WRAP))
                .putString("payload", android.util.Base64.encodeToString(payload, android.util.Base64.NO_WRAP))
                .commit();

        Log.i(TAG, "Q4 seeded alias=" + ALIAS_REBOOT + " — reboot now, then run verifyKeyAfterReboot");
    }

    /** Q4, part two: the same key opens the same ciphertext after a reboot. */
    @Test
    public void verifyKeyAfterReboot() throws Exception {
        KeyStore store = KeyStore.getInstance(STORE);
        store.load(null);
        assertTrue("the seeded key did not survive the reboot", store.containsAlias(ALIAS_REBOOT));

        android.content.Context context =
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
                        .getTargetContext();
        android.content.SharedPreferences saved =
                context.getSharedPreferences("gate0", android.content.Context.MODE_PRIVATE);
        byte[] iv = android.util.Base64.decode(saved.getString("iv", ""), android.util.Base64.NO_WRAP);
        byte[] wrapped = android.util.Base64.decode(saved.getString("wrapped", ""), android.util.Base64.NO_WRAP);
        byte[] payload = android.util.Base64.decode(saved.getString("payload", ""), android.util.Base64.NO_WRAP);
        assertEquals(32, payload.length);

        SecretKey key = (SecretKey) store.getKey(ALIAS_REBOOT, null);
        assertNotNull(key);

        Cipher open = Cipher.getInstance(TRANSFORM);
        open.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
        assertArrayEquals(payload, open.doFinal(wrapped));

        Log.i(TAG, "Q4 afterReboot=ok — the pre-reboot key opened pre-reboot ciphertext");

        drop(ALIAS_REBOOT);
    }

    /**
     * Q4, the half a test can answer: a key survives being fetched again in a
     * new process-level load of the store. Reboot, re-enrolment and reinstall
     * are recorded by hand in the spec's Log — a test cannot reboot the phone.
     */
    @Test
    public void keyPersistsAcrossStoreReload() throws Exception {
        drop(ALIAS);
        generate(ALIAS, false, false);

        KeyStore store = KeyStore.getInstance(STORE);
        store.load(null);
        assertTrue(store.containsAlias(ALIAS));

        SecretKey again = (SecretKey) store.getKey(ALIAS, null);
        assertNotNull(again);

        byte[] payload = new byte[32];
        new SecureRandom().nextBytes(payload);
        Cipher seal = Cipher.getInstance(TRANSFORM);
        seal.init(Cipher.ENCRYPT_MODE, again);
        byte[] wrapped = seal.doFinal(payload);

        Cipher open = Cipher.getInstance(TRANSFORM);
        open.init(Cipher.DECRYPT_MODE, again, new GCMParameterSpec(128, seal.getIV()));
        assertArrayEquals(payload, open.doFinal(wrapped));

        Log.i(TAG, "Q4 reloadedFromStore=ok alias=" + ALIAS);

        drop(ALIAS);
    }
}

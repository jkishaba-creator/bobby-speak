package com.bobbyspeak.keyboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BobbySetupStateTest {

    @Test
    fun `setup is not ready until Workers AI credentials are verified`() {
        val state = BobbySetupState(
            imeEnabled = true,
            imeSelected = true,
            microphoneGranted = true,
            cloudflareConfigured = true,
            cloudflareVerified = false
        )

        assertFalse(state.isReady)
        assertEquals(BobbySetupStep.VERIFY_CLOUDFLARE, state.nextStep)
    }

    @Test
    fun `setup is ready when all Android and Cloudflare checks pass`() {
        val state = BobbySetupState(
            imeEnabled = true,
            imeSelected = true,
            microphoneGranted = true,
            cloudflareConfigured = true,
            cloudflareVerified = true
        )

        assertTrue(state.isReady)
        assertEquals(BobbySetupStep.READY, state.nextStep)
    }

    @Test
    fun `setup orders Android prerequisites before Cloudflare`() {
        assertEquals(
            BobbySetupStep.ENABLE_IME,
            BobbySetupState(false, false, false, false, false).nextStep
        )
        assertEquals(
            BobbySetupStep.SELECT_IME,
            BobbySetupState(true, false, false, false, false).nextStep
        )
        assertEquals(
            BobbySetupStep.GRANT_MICROPHONE,
            BobbySetupState(true, true, false, false, false).nextStep
        )
        assertEquals(
            BobbySetupStep.CONFIGURE_CLOUDFLARE,
            BobbySetupState(true, true, true, false, false).nextStep
        )
    }

    @Test
    fun `saving unchanged credentials preserves successful verification`() {
        val credentials = CloudflareCredentials("account", "token")

        assertTrue(
            BobbyCredentialPreferences.verificationAfterSave(
                savedCredentials = credentials,
                submittedCredentials = credentials,
                wasVerified = true
            )
        )
    }

    @Test
    fun `saving changed credentials requires verification again`() {
        assertFalse(
            BobbyCredentialPreferences.verificationAfterSave(
                savedCredentials = CloudflareCredentials("account", "old-token"),
                submittedCredentials = CloudflareCredentials("account", "new-token"),
                wasVerified = true
            )
        )
    }

    @Test
    fun `credential preference changes refresh the visible voice setup state`() {
        assertTrue(
            BobbyCredentialPreferences.affectsVoiceSetup(
                BobbyCredentialPreferences.CLOUDFLARE_VERIFIED
            )
        )
        assertTrue(
            BobbyCredentialPreferences.affectsVoiceSetup(
                BobbyCredentialPreferences.CLOUDFLARE_ACCOUNT_ID
            )
        )
        assertFalse(BobbyCredentialPreferences.affectsVoiceSetup("unrelated"))
    }

}

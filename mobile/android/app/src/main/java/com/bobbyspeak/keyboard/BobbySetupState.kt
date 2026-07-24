package com.bobbyspeak.keyboard

import android.content.SharedPreferences

enum class BobbySetupStep {
    ENABLE_IME,
    SELECT_IME,
    GRANT_MICROPHONE,
    CONFIGURE_CLOUDFLARE,
    VERIFY_CLOUDFLARE,
    READY
}

internal object BobbyCredentialPreferences {
    const val FILE_NAME = "bobby_speak_prefs"
    const val CLOUDFLARE_ACCOUNT_ID = "cf_account_id"
    const val CLOUDFLARE_API_TOKEN = "cf_api_token"
    const val CLOUDFLARE_VERIFIED = "cf_verified"
    const val SELECTED_TONE = "selected_tone"
    // Retained only to migrate selections written by the original Android MVP.
    const val SELECTED_ACTION = "selected_action"
    const val DEFAULT_TONE = "None"

    private val voiceSetupKeys = setOf(
        CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN,
        CLOUDFLARE_VERIFIED
    )

    fun affectsVoiceSetup(key: String?): Boolean = key in voiceSetupKeys

    fun verificationAfterSave(
        savedCredentials: CloudflareCredentials,
        submittedCredentials: CloudflareCredentials,
        wasVerified: Boolean
    ): Boolean = wasVerified && savedCredentials == submittedCredentials

    fun getSelectedTone(prefs: SharedPreferences): ImeTone =
        ImeTone.fromId(prefs.getString(SELECTED_TONE, DEFAULT_TONE))

    fun setSelectedTone(prefs: SharedPreferences, tone: ImeTone) {
        prefs.edit().putString(SELECTED_TONE, tone.id).apply()
    }

}

data class BobbySetupState(
    val imeEnabled: Boolean,
    val imeSelected: Boolean,
    val microphoneGranted: Boolean,
    val cloudflareConfigured: Boolean,
    val cloudflareVerified: Boolean
) {
    val nextStep: BobbySetupStep
        get() = when {
            !imeEnabled -> BobbySetupStep.ENABLE_IME
            !imeSelected -> BobbySetupStep.SELECT_IME
            !microphoneGranted -> BobbySetupStep.GRANT_MICROPHONE
            !cloudflareConfigured -> BobbySetupStep.CONFIGURE_CLOUDFLARE
            !cloudflareVerified -> BobbySetupStep.VERIFY_CLOUDFLARE
            else -> BobbySetupStep.READY
        }

    val isReady: Boolean
        get() = nextStep == BobbySetupStep.READY
}

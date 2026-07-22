package com.bobbyspeak.keyboard

enum class BobbySetupStep {
    ENABLE_IME,
    SELECT_IME,
    GRANT_MICROPHONE,
    CONFIGURE_CLOUDFLARE,
    VERIFY_CLOUDFLARE,
    READY
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

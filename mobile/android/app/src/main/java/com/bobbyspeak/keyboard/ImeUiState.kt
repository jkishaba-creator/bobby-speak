package com.bobbyspeak.keyboard

enum class ImeTone(val id: String, val label: String) {
    NONE("None", "None"),
    PROFESSIONAL("Professional", "Professional"),
    DIRECT("Direct", "Direct"),
    CONFIDENT("Confident", "Confident");

    companion object {
        fun fromId(id: String?): ImeTone =
            entries.firstOrNull { it.id.equals(id, ignoreCase = true) } ?: NONE
    }
}

enum class ImeVoicePhase {
    IDLE,
    LISTENING,
    PROCESSING,
    SUCCESS,
    ERROR
}

enum class ImeSetupRequirement {
    MICROPHONE,
    CLOUDFLARE
}

enum class ImeVoiceAction {
    START,
    STOP,
    OPEN_SETUP,
    NONE
}

enum class ImeVoiceTone {
    NEUTRAL,
    PRIMARY,
    RECORDING,
    SUCCESS,
    WARNING,
    ERROR,
    MUTED
}

internal fun activeVoicePhase(
    isRecording: Boolean,
    isProcessing: Boolean,
    fallback: ImeVoicePhase
): ImeVoicePhase = when {
    isRecording -> ImeVoicePhase.LISTENING
    isProcessing -> ImeVoicePhase.PROCESSING
    else -> fallback
}

data class ImeUiState(
    val message: String,
    val micAction: ImeVoiceAction,
    val micEnabled: Boolean,
    val tone: ImeVoiceTone
) {
    companion object {
        fun resolve(
            phase: ImeVoicePhase = ImeVoicePhase.IDLE,
            setupRequirement: ImeSetupRequirement? = null,
            isSensitiveField: Boolean = false,
            errorMessage: String = "Something went wrong. Tap to try again"
        ): ImeUiState {
            if (isSensitiveField) {
                return ImeUiState(
                    message = "Voice is off in password fields",
                    micAction = ImeVoiceAction.NONE,
                    micEnabled = false,
                    tone = ImeVoiceTone.MUTED
                )
            }

            if (setupRequirement != null) {
                val message = when (setupRequirement) {
                    ImeSetupRequirement.MICROPHONE -> "Allow microphone to use voice"
                    ImeSetupRequirement.CLOUDFLARE -> "Finish setup to use voice"
                }
                return ImeUiState(
                    message = message,
                    micAction = ImeVoiceAction.OPEN_SETUP,
                    micEnabled = true,
                    tone = ImeVoiceTone.WARNING
                )
            }

            return when (phase) {
                ImeVoicePhase.IDLE -> ImeUiState(
                    message = "Tap the mic to speak",
                    micAction = ImeVoiceAction.START,
                    micEnabled = true,
                    tone = ImeVoiceTone.PRIMARY
                )
                ImeVoicePhase.LISTENING -> ImeUiState(
                    message = "Listening…",
                    micAction = ImeVoiceAction.STOP,
                    micEnabled = true,
                    tone = ImeVoiceTone.RECORDING
                )
                ImeVoicePhase.PROCESSING -> ImeUiState(
                    message = "Writing…",
                    micAction = ImeVoiceAction.NONE,
                    micEnabled = false,
                    tone = ImeVoiceTone.NEUTRAL
                )
                ImeVoicePhase.SUCCESS -> ImeUiState(
                    message = "Added to text",
                    micAction = ImeVoiceAction.START,
                    micEnabled = true,
                    tone = ImeVoiceTone.SUCCESS
                )
                ImeVoicePhase.ERROR -> ImeUiState(
                    message = errorMessage,
                    micAction = ImeVoiceAction.START,
                    micEnabled = true,
                    tone = ImeVoiceTone.ERROR
                )
            }
        }
    }
}

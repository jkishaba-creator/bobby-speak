package com.bobbyspeak.keyboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImeUiStateTest {

    @Test
    fun `missing Cloudflare setup offers setup without disabling typing`() {
        val state = ImeUiState.resolve(
            setupRequirement = ImeSetupRequirement.CLOUDFLARE
        )

        assertEquals("Finish setup to use voice", state.message)
        assertEquals(ImeVoiceAction.OPEN_SETUP, state.micAction)
        assertTrue(state.micEnabled)
    }

    @Test
    fun `ready keyboard invites a simple mic tap`() {
        val state = ImeUiState.resolve()

        assertEquals("Tap the mic to speak", state.message)
        assertEquals(ImeVoiceAction.START, state.micAction)
        assertTrue(state.micEnabled)
    }

    @Test
    fun `recording uses a clear listening state and stop action`() {
        val state = ImeUiState.resolve(phase = ImeVoicePhase.LISTENING)

        assertEquals("Listening\u2026", state.message)
        assertEquals(ImeVoiceAction.STOP, state.micAction)
        assertEquals(ImeVoiceTone.RECORDING, state.tone)
    }

    @Test
    fun `processing explains the short wait and prevents duplicate taps`() {
        val state = ImeUiState.resolve(phase = ImeVoicePhase.PROCESSING)

        assertEquals("Writing\u2026", state.message)
        assertEquals(ImeVoiceAction.NONE, state.micAction)
        assertFalse(state.micEnabled)
    }

    @Test
    fun `success confirms that dictated text reached the field`() {
        val state = ImeUiState.resolve(phase = ImeVoicePhase.SUCCESS)

        assertEquals("Added to text", state.message)
        assertEquals(ImeVoiceTone.SUCCESS, state.tone)
    }

    @Test
    fun `password fields keep typing available but turn voice off`() {
        val state = ImeUiState.resolve(
            phase = ImeVoicePhase.LISTENING,
            isSensitiveField = true
        )

        assertEquals("Voice is off in password fields", state.message)
        assertEquals(ImeVoiceAction.NONE, state.micAction)
        assertFalse(state.micEnabled)
    }

    @Test
    fun `restarting the input view preserves active processing`() {
        assertEquals(
            ImeVoicePhase.PROCESSING,
            activeVoicePhase(
                isRecording = false,
                isProcessing = true,
                fallback = ImeVoicePhase.IDLE
            )
        )
    }

    @Test
    fun `recording takes precedence while restoring an input view`() {
        assertEquals(
            ImeVoicePhase.LISTENING,
            activeVoicePhase(
                isRecording = true,
                isProcessing = true,
                fallback = ImeVoicePhase.IDLE
            )
        )
    }
}

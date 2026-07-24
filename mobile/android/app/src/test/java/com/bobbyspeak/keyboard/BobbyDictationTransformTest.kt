package com.bobbyspeak.keyboard

import org.junit.Assert.assertEquals
import org.junit.Test

class BobbyDictationTransformTest {

    @Test
    fun `successful action result replaces the raw transcript`() {
        assertEquals(
            "Finished text",
            BobbyDictationTransform.finalText(
                raw = "raw words",
                result = CloudflareResult.Success("Finished text")
            )
        )
    }

    @Test
    fun `blank action result preserves the raw transcript`() {
        assertEquals(
            "raw words",
            BobbyDictationTransform.finalText(
                raw = "raw words",
                result = CloudflareResult.Success("   ")
            )
        )
    }

    @Test
    fun `failed action preserves the raw transcript`() {
        assertEquals(
            "raw words",
            BobbyDictationTransform.finalText(
                raw = "raw words",
                result = CloudflareResult.Failure(
                    CloudflareFailureKind.NETWORK,
                    "offline"
                )
            )
        )
    }

    @Test
    fun `failed action outcome preserves raw text and exposes a non blocking error`() {
        val outcome = BobbyDictationTransform.outcome(
            raw = "raw words",
            result = CloudflareResult.Failure(
                CloudflareFailureKind.NETWORK,
                "offline"
            )
        )

        assertEquals("raw words", outcome.text)
        assertEquals("offline", outcome.errorMessage)
    }

    @Test
    fun `successful action outcome has no error`() {
        val outcome = BobbyDictationTransform.outcome(
            raw = "raw words",
            result = CloudflareResult.Success("Finished text")
        )

        assertEquals("Finished text", outcome.text)
        assertEquals(null, outcome.errorMessage)
    }

    @Test
    fun `execute passes selected type and tone to the action runner`() {
        var capturedAction: BobbyTextAction? = null
        var capturedTone: ImeTone? = null
        val selection = BobbyDictationSelection(
            action = BobbyActionCatalog.summarize,
            tone = ImeTone.CONFIDENT
        )

        val outcome = BobbyDictationTransform.execute(
            raw = "A long transcript",
            selection = selection
        ) { _, action, tone ->
            capturedAction = action
            capturedTone = tone
            CloudflareResult.Success("A summary")
        }

        assertEquals("summarize", capturedAction?.id)
        assertEquals(ImeTone.CONFIDENT, capturedTone)
        assertEquals("A summary", outcome.text)
    }
}

package com.bobbyspeak.keyboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BobbyTranscriptHistoryTest {

    @Test
    fun `successful transform exposes the previous transcript once`() {
        val history = BobbyTranscriptHistory()

        history.recordTransform(
            before = "before",
            result = CloudflareResult.Success("after")
        )

        assertTrue(history.canUndo)
        assertEquals("before", history.takeUndo())
        assertFalse(history.canUndo)
        assertNull(history.takeUndo())
    }

    @Test
    fun `failed or unchanged transform does not expose undo`() {
        val history = BobbyTranscriptHistory()

        history.recordTransform(
            before = "before",
            result = CloudflareResult.Failure(
                CloudflareFailureKind.NETWORK,
                "offline"
            )
        )
        assertFalse(history.canUndo)

        history.recordTransform(
            before = "same",
            result = CloudflareResult.Success("same")
        )
        assertFalse(history.canUndo)
    }

    @Test
    fun `clear removes pending undo state`() {
        val history = BobbyTranscriptHistory()
        history.recordTransform("before", CloudflareResult.Success("after"))

        history.clear()

        assertFalse(history.canUndo)
    }
}

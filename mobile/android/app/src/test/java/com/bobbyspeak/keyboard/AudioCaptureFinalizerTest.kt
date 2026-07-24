package com.bobbyspeak.keyboard

import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class AudioCaptureFinalizerTest {

    @Test
    fun `final capture read completes before recorder stops and PCM is copied`() = runBlocking {
        val events = mutableListOf<String>()
        val captureJob = launch {
            events += "final read"
        }

        val pcm = finalizeAudioCapture(
            captureJob = captureJob,
            stopAndRelease = { events += "stop and release" },
            copyPcm = {
                events += "copy PCM"
                byteArrayOf(1, 2, 3)
            }
        )

        assertEquals(listOf("final read", "stop and release", "copy PCM"), events)
        assertEquals(listOf<Byte>(1, 2, 3), pcm.toList())
    }
}

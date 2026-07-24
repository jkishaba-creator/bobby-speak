package com.bobbyspeak.keyboard

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class BobbyWavEncoderTest {

    @Test
    fun `encoding PCM produces a valid little endian mono WAV payload`() {
        val pcm = byteArrayOf(1, 2, 3, 4)

        val wav = BobbyWavEncoder.encode(
            pcmBytes = pcm,
            sampleRate = 16_000,
            channels = 1,
            bitsPerSample = 16
        )

        assertEquals(48, wav.size)
        assertEquals("RIFF", wav.copyOfRange(0, 4).toString(Charsets.US_ASCII))
        assertEquals("WAVE", wav.copyOfRange(8, 12).toString(Charsets.US_ASCII))
        assertEquals("data", wav.copyOfRange(36, 40).toString(Charsets.US_ASCII))
        assertEquals(4, littleEndianInt(wav, 40))
        assertArrayEquals(pcm, wav.copyOfRange(44, wav.size))
    }

    private fun littleEndianInt(bytes: ByteArray, offset: Int): Int =
        (bytes[offset].toInt() and 0xff) or
            ((bytes[offset + 1].toInt() and 0xff) shl 8) or
            ((bytes[offset + 2].toInt() and 0xff) shl 16) or
            ((bytes[offset + 3].toInt() and 0xff) shl 24)
}

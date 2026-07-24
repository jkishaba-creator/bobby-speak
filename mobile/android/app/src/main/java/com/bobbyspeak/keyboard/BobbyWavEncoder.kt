package com.bobbyspeak.keyboard

import java.nio.ByteBuffer
import java.nio.ByteOrder

internal object BobbyWavEncoder {
    private const val headerSize = 44

    fun encode(
        pcmBytes: ByteArray,
        sampleRate: Int,
        channels: Int,
        bitsPerSample: Int
    ): ByteArray {
        require(sampleRate > 0)
        require(channels > 0)
        require(bitsPerSample > 0 && bitsPerSample % 8 == 0)

        val blockAlign = channels * bitsPerSample / 8
        val byteRate = sampleRate * blockAlign
        return ByteBuffer.allocate(headerSize + pcmBytes.size)
            .order(ByteOrder.LITTLE_ENDIAN)
            .apply {
                put("RIFF".toByteArray(Charsets.US_ASCII))
                putInt(pcmBytes.size + 36)
                put("WAVE".toByteArray(Charsets.US_ASCII))
                put("fmt ".toByteArray(Charsets.US_ASCII))
                putInt(16)
                putShort(1)
                putShort(channels.toShort())
                putInt(sampleRate)
                putInt(byteRate)
                putShort(blockAlign.toShort())
                putShort(bitsPerSample.toShort())
                put("data".toByteArray(Charsets.US_ASCII))
                putInt(pcmBytes.size)
                put(pcmBytes)
            }
            .array()
    }
}

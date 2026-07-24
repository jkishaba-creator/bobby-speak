package com.bobbyspeak.keyboard

internal class BobbyTranscriptHistory {
    private var previous: String? = null

    val canUndo: Boolean
        get() = previous != null

    fun recordTransform(
        before: String,
        result: CloudflareResult<String>
    ) {
        val after = (result as? CloudflareResult.Success)?.value
        previous = before.takeIf {
            after != null && after.isNotBlank() && after != before
        }
    }

    fun takeUndo(): String? {
        val value = previous
        previous = null
        return value
    }

    fun clear() {
        previous = null
    }
}

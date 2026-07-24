package com.bobbyspeak.keyboard

import android.media.AudioRecord
import android.util.Log
import kotlinx.coroutines.Job

internal suspend fun finalizeAudioCapture(
    captureJob: Job?,
    stopAndRelease: () -> Unit,
    copyPcm: () -> ByteArray
): ByteArray {
    captureJob?.join()
    stopAndRelease()
    return copyPcm()
}

internal fun stopAndReleaseAudioRecord(
    recorder: AudioRecord?,
    logTag: String
) {
    if (recorder == null) return
    try {
        if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
            recorder.stop()
        }
    } catch (error: Exception) {
        Log.e(logTag, "Error stopping AudioRecord", error)
    } finally {
        try {
            recorder.release()
        } catch (error: Exception) {
            Log.e(logTag, "Error releasing AudioRecord", error)
        }
    }
}

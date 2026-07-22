package com.bobbyspeak.keyboard

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.inputmethodservice.InputMethodService
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream

/**
 * Bobby Speak Android Dictation Keyboard (InputMethodService).
 *
 * Implements Issue #7 MVP & Issue #6 system prompt:
 * - Always forces input view visibility on screen via onEvaluateInputViewShown.
 * - Shows full-width dictation & editing panel.
 * - Records 16kHz mono 16-bit PCM audio via AudioRecord.
 * - Prepends 44-byte WAV header and encodes Base64.
 * - Calls Cloudflare Whisper ASR (@cf/openai/whisper-large-v3-turbo).
 * - Calls Cloudflare Llama 3.3 (@cf/meta/llama-3.3-70b-instruct-fp8-fast) for smart formatting.
 * - Commits clean text to current field via InputConnection.commitText().
 * - Configurable via BobbySettingsActivity.
 */
class BobbyInputMethodService : InputMethodService() {

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val cloudflareClient = CloudflareClient()
    @Volatile
    private var isRecording = false
    private var audioRecord: AudioRecord? = null
    private var recordingJob: Job? = null
    private val sampleRate = 16000
    private var pcmOutputStream: ByteArrayOutputStream? = null

    private lateinit var statusLabel: TextView
    private lateinit var micButton: Button

    companion object {
        private const val TAG = "BobbyIME"
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service onCreate called")
    }

    override fun onEvaluateInputViewShown(): Boolean {
        super.onEvaluateInputViewShown()
        return true // Always force soft keyboard view on screen regardless of hardware keyboard!
    }

    override fun onShowInputRequested(flags: Int, configChange: Boolean): Boolean {
        return true
    }

    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        if (::statusLabel.isInitialized) {
            showIdleStatus()
        }
    }

    @android.annotation.SuppressLint("SetTextI18n")
    override fun onCreateInputView(): View {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setBackgroundColor(android.graphics.Color.parseColor("#0F172A")) // Modern Dark Blue
            setPadding(32, 32, 32, 32)
        }

        statusLabel = TextView(this).apply {
            text = "🟢 Ready to dictate via Cloudflare AI"
            setTextColor(android.graphics.Color.parseColor("#10B981")) // Green Ready Indicator
            textSize = 14f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, 16)
        }

        micButton = Button(this).apply {
            text = "🎤 TAP ME TO DICTATE"
            textSize = 16f
            setBackgroundColor(android.graphics.Color.parseColor("#E11D48")) // Red Accent
            setTextColor(android.graphics.Color.WHITE)
            setPadding(20, 20, 20, 20)
            setOnClickListener {
                if (!isRecording) {
                    startDictation()
                } else {
                    stopDictation()
                }
            }
        }

        val settingsButton = Button(this).apply {
            text = "⚙ Settings & Connection Check"
            textSize = 14f
            setBackgroundColor(android.graphics.Color.parseColor("#334155"))
            setTextColor(android.graphics.Color.WHITE)
            setOnClickListener {
                val intent = Intent(this@BobbyInputMethodService, BobbySettingsActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
            }
        }

        val spaceButton = Button(this).apply {
            text = "Space"
            textSize = 14f
            setBackgroundColor(android.graphics.Color.parseColor("#475569"))
            setTextColor(android.graphics.Color.WHITE)
            setOnClickListener {
                currentInputConnection?.commitText(" ", 1)
            }
        }

        val deleteButton = Button(this).apply {
            text = "⌫ Delete"
            textSize = 14f
            setBackgroundColor(android.graphics.Color.parseColor("#475569"))
            setTextColor(android.graphics.Color.WHITE)
            setOnClickListener {
                currentInputConnection?.deleteSurroundingText(1, 0)
            }
        }

        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(micButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 2f))
            addView(settingsButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }

        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 12, 0, 0)
            addView(spaceButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 2f))
            addView(deleteButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }

        layout.addView(statusLabel)
        layout.addView(row1)
        layout.addView(row2)
        showIdleStatus()
        return layout
    }

    private fun showIdleStatus() {
        val verified = getSharedPreferences("bobby_speak_prefs", Context.MODE_PRIVATE)
            .getBoolean("cf_verified", false)
        statusLabel.text = if (verified) {
            "🟢 Ready to dictate via Cloudflare AI"
        } else {
            "⚠️ Finish Cloudflare setup before dictating"
        }
        statusLabel.setTextColor(
            android.graphics.Color.parseColor(if (verified) "#10B981" else "#F59E0B")
        )
    }

    @android.annotation.SuppressLint("SetTextI18n")
    private fun startDictation() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            val intent = Intent(this, PermissionActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
            Toast.makeText(this, "Please grant microphone permission", Toast.LENGTH_SHORT).show()
            return
        }

        try {
            val minBufSize = AudioRecord.getMinBufferSize(
                sampleRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            )
            val bufferSize = Math.max(minBufSize, 4096)

            val recorder = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            )
            audioRecord = recorder

            if (recorder.state != AudioRecord.STATE_INITIALIZED) {
                recorder.release()
                audioRecord = null
                statusLabel.text = "❌ AudioRecord initialization failed"
                Toast.makeText(this, "AudioRecord init failed", Toast.LENGTH_SHORT).show()
                return
            }

            val outputStream = ByteArrayOutputStream()
            pcmOutputStream = outputStream
            recorder.startRecording()
            isRecording = true

            micButton.text = "⏹ STOP & TRANSCRIBE"
            micButton.setBackgroundColor(android.graphics.Color.parseColor("#DC2626"))
            statusLabel.text = "🔴 Recording audio (16kHz mono)... Speak now!"
            statusLabel.setTextColor(android.graphics.Color.parseColor("#EF4444"))
            Toast.makeText(this, "🔴 Recording started... Speak into mic!", Toast.LENGTH_SHORT).show()

            recordingJob = serviceScope.launch {
                val data = ByteArray(bufferSize)
                try {
                    while (isRecording) {
                        val read = recorder.read(data, 0, data.size)
                        if (read > 0) {
                            outputStream.write(data, 0, read)
                        }
                    }
                } catch (e: Exception) {
                    if (isRecording) Log.e(TAG, "Audio capture failed", e)
                }
            }
        } catch (e: Exception) {
            isRecording = false
            try {
                audioRecord?.release()
            } catch (_: Exception) {
                // The original mic exception is more useful.
            }
            audioRecord = null
            Log.e(TAG, "Error starting dictation", e)
            statusLabel.text = "❌ Mic error: ${e.message}"
            statusLabel.setTextColor(android.graphics.Color.parseColor("#F87171"))
            Toast.makeText(this, "Mic error: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    @android.annotation.SuppressLint("SetTextI18n")
    private fun stopDictation() {
        isRecording = false
        val recorder = audioRecord
        audioRecord = null
        try {
            recorder?.stop()
            recorder?.release()
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping audioRecord", e)
        }

        micButton.text = "🎤 TAP ME TO DICTATE"
        micButton.setBackgroundColor(android.graphics.Color.parseColor("#E11D48"))
        micButton.isEnabled = false
        statusLabel.text = "⏳ Processing transcription via Cloudflare AI..."
        statusLabel.setTextColor(android.graphics.Color.parseColor("#F59E0B"))

        val completedCapture = recordingJob
        recordingJob = null
        val completedOutput = pcmOutputStream
        pcmOutputStream = null

        serviceScope.launch {
            try {
                completedCapture?.join()
                processCapturedAudio(completedOutput?.toByteArray() ?: ByteArray(0))
            } catch (e: Exception) {
                Log.e(TAG, "Unexpected dictation error", e)
                withContext(Dispatchers.Main) {
                    statusLabel.text = "❌ Error: ${e.localizedMessage}"
                    statusLabel.setTextColor(android.graphics.Color.parseColor("#F87171"))
                    Toast.makeText(
                        this@BobbyInputMethodService,
                        "Dictation error: ${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            } finally {
                withContext(Dispatchers.Main) { micButton.isEnabled = true }
            }
        }
    }

    @android.annotation.SuppressLint("SetTextI18n")
    private suspend fun processCapturedAudio(rawPcm: ByteArray) {
        withContext(Dispatchers.Main) {
            Toast.makeText(
                this@BobbyInputMethodService,
                "Captured ${rawPcm.size} bytes of audio",
                Toast.LENGTH_SHORT
            ).show()
        }

        if (rawPcm.isEmpty()) {
            withContext(Dispatchers.Main) {
                statusLabel.text = "⚠️ No audio recorded (0 bytes)."
                statusLabel.setTextColor(android.graphics.Color.parseColor("#F59E0B"))
            }
            return
        }

        val wavBytes = addWavHeader(rawPcm, sampleRate, 1, 16)
        val base64Wav = Base64.encodeToString(wavBytes, Base64.NO_WRAP)

        val prefs = getSharedPreferences("bobby_speak_prefs", Context.MODE_PRIVATE)
        val credentials = CloudflareCredentials.fromRaw(
            prefs.getString("cf_account_id", "") ?: "",
            prefs.getString("cf_api_token", "") ?: ""
        )

        if (!credentials.isComplete) {
            withContext(Dispatchers.Main) {
                statusLabel.text = "⚠️ Please set Cloudflare Account ID & API Token in ⚙ Settings"
                statusLabel.setTextColor(android.graphics.Color.parseColor("#F87171"))
                Toast.makeText(
                    this@BobbyInputMethodService,
                    "Set Cloudflare credentials in ⚙ Settings",
                    Toast.LENGTH_LONG
                ).show()
            }
            return
        }

        val transcript = when (
            val result = cloudflareClient.transcribe(credentials, base64Wav)
        ) {
            is CloudflareResult.Success -> result.value
            is CloudflareResult.Failure -> {
                if (result.kind == CloudflareFailureKind.AUTHORIZATION ||
                    result.kind == CloudflareFailureKind.CREDENTIALS ||
                    result.kind == CloudflareFailureKind.NOT_FOUND
                ) {
                    getSharedPreferences("bobby_speak_prefs", Context.MODE_PRIVATE)
                        .edit()
                        .putBoolean("cf_verified", false)
                        .apply()
                }
                withContext(Dispatchers.Main) {
                    statusLabel.text = "❌ Transcription failed: ${result.message}"
                    statusLabel.setTextColor(android.graphics.Color.parseColor("#F87171"))
                    Toast.makeText(
                        this@BobbyInputMethodService,
                        "Transcription failed: ${result.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
                return
            }
        }

        getSharedPreferences("bobby_speak_prefs", Context.MODE_PRIVATE)
            .edit()
            .putBoolean("cf_verified", true)
            .apply()

        val polishResult = cloudflareClient.polish(credentials, transcript)
        val textToCommit = when (polishResult) {
            is CloudflareResult.Success -> polishResult.value
            is CloudflareResult.Failure -> transcript
        }

        withContext(Dispatchers.Main) {
            val inputConnection = currentInputConnection
            if (inputConnection == null || !inputConnection.commitText(textToCommit, 1)) {
                statusLabel.text = "❌ No active text field to receive dictation"
                statusLabel.setTextColor(android.graphics.Color.parseColor("#F87171"))
                Toast.makeText(
                    this@BobbyInputMethodService,
                    "Tap a text field and try again",
                    Toast.LENGTH_LONG
                ).show()
            } else if (polishResult is CloudflareResult.Failure) {
                statusLabel.text = "✓ Dictation typed; smart formatting was unavailable"
                statusLabel.setTextColor(android.graphics.Color.parseColor("#F59E0B"))
                Toast.makeText(
                    this@BobbyInputMethodService,
                    "Typed the transcript without AI formatting: ${polishResult.message}",
                    Toast.LENGTH_LONG
                ).show()
            } else {
                statusLabel.text = "✓ Dictation typed successfully"
                statusLabel.setTextColor(android.graphics.Color.parseColor("#10B981"))
                Toast.makeText(
                    this@BobbyInputMethodService,
                    "Dictation typed",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
    }

    private fun addWavHeader(pcmBytes: ByteArray, sampleRate: Int, channels: Int, bitsPerSample: Int): ByteArray {
        val header = ByteArray(44)
        val totalDataLen = pcmBytes.size + 36
        val byteRate = sampleRate * channels * bitsPerSample / 8

        header[0] = 'R'.code.toByte()
        header[1] = 'I'.code.toByte()
        header[2] = 'F'.code.toByte()
        header[3] = 'F'.code.toByte()
        header[4] = (totalDataLen and 0xff).toByte()
        header[5] = (totalDataLen shr 8 and 0xff).toByte()
        header[6] = (totalDataLen shr 16 and 0xff).toByte()
        header[7] = (totalDataLen shr 24 and 0xff).toByte()
        header[8] = 'W'.code.toByte()
        header[9] = 'A'.code.toByte()
        header[10] = 'V'.code.toByte()
        header[11] = 'E'.code.toByte()
        header[12] = 'f'.code.toByte()
        header[13] = 'm'.code.toByte()
        header[14] = 't'.code.toByte()
        header[15] = ' '.code.toByte()
        header[16] = 16
        header[17] = 0
        header[18] = 0
        header[19] = 0
        header[20] = 1
        header[21] = 0
        header[22] = channels.toByte()
        header[23] = 0
        header[24] = (sampleRate and 0xff).toByte()
        header[25] = (sampleRate shr 8 and 0xff).toByte()
        header[26] = (sampleRate shr 16 and 0xff).toByte()
        header[27] = (sampleRate shr 24 and 0xff).toByte()
        header[28] = (byteRate and 0xff).toByte()
        header[29] = (byteRate shr 8 and 0xff).toByte()
        header[30] = (byteRate shr 16 and 0xff).toByte()
        header[31] = (byteRate shr 24 and 0xff).toByte()
        header[32] = (channels * bitsPerSample / 8).toByte()
        header[33] = 0
        header[34] = bitsPerSample.toByte()
        header[35] = 0
        header[36] = 'd'.code.toByte()
        header[37] = 'a'.code.toByte()
        header[38] = 't'.code.toByte()
        header[39] = 'a'.code.toByte()
        header[40] = (pcmBytes.size and 0xff).toByte()
        header[41] = (pcmBytes.size shr 8 and 0xff).toByte()
        header[42] = (pcmBytes.size shr 16 and 0xff).toByte()
        header[43] = (pcmBytes.size shr 24 and 0xff).toByte()

        val out = ByteArray(header.size + pcmBytes.size)
        System.arraycopy(header, 0, out, 0, header.size)
        System.arraycopy(pcmBytes, 0, out, header.size, pcmBytes.size)
        return out
    }

    override fun onDestroy() {
        isRecording = false
        try {
            if (audioRecord?.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                audioRecord?.stop()
            }
            audioRecord?.release()
        } catch (e: Exception) {
            Log.e(TAG, "Error releasing AudioRecord", e)
        }
        recordingJob?.cancel()
        serviceScope.cancel()
        super.onDestroy()
    }
}

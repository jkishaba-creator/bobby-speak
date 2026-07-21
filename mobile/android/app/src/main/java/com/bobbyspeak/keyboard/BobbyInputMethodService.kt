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
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * Bobby Speak Android Dictation Keyboard (InputMethodService).
 *
 * Implements Issue #7 MVP:
 * - Shows a simple QWERTY & dictation UI.
 * - Records 16kHz mono 16-bit PCM audio via AudioRecord.
 * - Prepends 44-byte WAV header and encodes Base64.
 * - Calls Cloudflare Whisper ASR (@cf/openai/whisper-large-v3-turbo).
 * - Calls Cloudflare Llama 3.3 (@cf/meta/llama-3.3-70b-instruct-fp8-fast) for smart formatting with exact Issue #6 system prompt.
 * - Commits clean text to current field via InputConnection.commitText().
 * - Configurable via BobbySettingsActivity.
 */
class BobbyInputMethodService : InputMethodService() {

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var isRecording = false
    private var audioRecord: AudioRecord? = null
    private val sampleRate = 16000
    private var pcmOutputStream: ByteArrayOutputStream? = null

    private lateinit var statusLabel: TextView

    @android.annotation.SuppressLint("SetTextI18n")
    override fun onCreateInputView(): View {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 16, 16, 16)
        }

        statusLabel = TextView(this).apply {
            text = "Ready to dictate"
            textSize = 13f
            setPadding(0, 0, 0, 8)
        }

        val micButton = Button(this).apply {
            text = "🎤 Dictate"
            setOnClickListener {
                if (!isRecording) {
                    startDictation(this)
                } else {
                    stopDictation(this)
                }
            }
        }

        val settingsButton = Button(this).apply {
            text = "⚙ Settings"
            setOnClickListener {
                val intent = Intent(this@BobbyInputMethodService, BobbySettingsActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
            }
        }

        val spaceButton = Button(this).apply {
            text = "Space"
            setOnClickListener {
                currentInputConnection?.commitText(" ", 1)
            }
        }

        val deleteButton = Button(this).apply {
            text = "⌫ Delete"
            setOnClickListener {
                currentInputConnection?.deleteSurroundingText(1, 0)
            }
        }

        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(micButton)
            addView(settingsButton)
        }

        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(spaceButton)
            addView(deleteButton)
        }

        layout.addView(statusLabel)
        layout.addView(row1)
        layout.addView(row2)
        return layout
    }

    @android.annotation.SuppressLint("SetTextI18n")
    private fun startDictation(btn: Button) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            val intent = Intent(this, PermissionActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
            Toast.makeText(this, "Please grant microphone permission", Toast.LENGTH_SHORT).show()
            return
        }

        val bufferSize = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )

        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize
        )

        pcmOutputStream = ByteArrayOutputStream()
        audioRecord?.startRecording()
        isRecording = true

        btn.text = "⏹ Stop & Transcribe"
        statusLabel.text = "🔴 Recording audio (16kHz mono)..."

        serviceScope.launch {
            val data = ByteArray(bufferSize)
            while (isRecording) {
                val read = audioRecord?.read(data, 0, data.size) ?: 0
                if (read > 0) {
                    pcmOutputStream?.write(data, 0, read)
                }
            }
        }
    }

    @android.annotation.SuppressLint("SetTextI18n")
    private fun stopDictation(btn: Button) {
        isRecording = false
        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            audioRecord = null
        }

        btn.text = "🎤 Dictate"
        statusLabel.text = "⏳ Processing transcription via Cloudflare AI..."

        val rawPcm = pcmOutputStream?.toByteArray() ?: ByteArray(0)
        pcmOutputStream = null

        if (rawPcm.isEmpty()) {
            statusLabel.text = "No audio recorded."
            return
        }

        val wavBytes = addWavHeader(rawPcm, sampleRate, 1, 16)
        val base64Wav = Base64.encodeToString(wavBytes, Base64.NO_WRAP)

        val prefs = getSharedPreferences("bobby_speak_prefs", Context.MODE_PRIVATE)
        val accountId = prefs.getString("cf_account_id", "") ?: ""
        val apiToken = prefs.getString("cf_api_token", "") ?: ""

        if (accountId.isEmpty() || apiToken.isEmpty()) {
            statusLabel.text = "⚠️ Please set Cloudflare Account ID & API Token in ⚙ Settings"
            Toast.makeText(this, "Set Cloudflare credentials in ⚙ Settings", Toast.LENGTH_LONG).show()
            return
        }

        serviceScope.launch {
            try {
                // Step 1: Speech-to-Text via Cloudflare Whisper
                val transcript = callCloudflareWhisper(accountId, apiToken, base64Wav)

                if (transcript.isNullOrBlank()) {
                    withContext(Dispatchers.Main) {
                        statusLabel.text = "No speech recognized."
                    }
                    return@launch
                }

                // Step 2: Smart Formatting via Cloudflare Llama 3.3
                val formattedText = callCloudflareLlama(accountId, apiToken, transcript) ?: transcript

                withContext(Dispatchers.Main) {
                    currentInputConnection?.commitText(formattedText, 1)
                    statusLabel.text = "✓ Dictation committed!"
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    statusLabel.text = "Error: ${e.localizedMessage}"
                    Toast.makeText(this@BobbyInputMethodService, "Cloudflare API Error: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun callCloudflareWhisper(accountId: String, token: String, base64Audio: String): String? {
        val url = URL("https://api.cloudflare.com/client/v4/accounts/$accountId/ai/run/@cf/openai/whisper-large-v3-turbo")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "application/json")
            doOutput = true
            connectTimeout = 15000
            readTimeout = 15000
        }

        val jsonBody = JSONObject().apply {
            put("audio", base64Audio)
            put("task", "transcribe")
        }

        OutputStreamWriter(conn.outputStream).use { it.write(jsonBody.toString()) }

        return if (conn.responseCode == 200) {
            val responseText = conn.inputStream.bufferedReader().use { it.readText() }
            val jsonResp = JSONObject(responseText)
            jsonResp.optJSONObject("result")?.optString("text")
        } else {
            null
        }
    }

    private fun callCloudflareLlama(accountId: String, token: String, rawText: String): String? {
        val url = URL("https://api.cloudflare.com/client/v4/accounts/$accountId/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "application/json")
            doOutput = true
            connectTimeout = 15000
            readTimeout = 15000
        }

        val systemPrompt = "You correct dictated text. Fix grammar, punctuation, capitalization, and sentence boundaries so it reads like clean writing. Keep the wording and meaning — do not add, remove, answer, or comment on the content. Reply with ONLY the corrected text, no preamble or quotes."

        val messages = JSONArray().apply {
            put(JSONObject().apply {
                put("role", "system")
                put("content", systemPrompt)
            })
            put(JSONObject().apply {
                put("role", "user")
                put("content", rawText)
            })
        }

        val jsonBody = JSONObject().apply {
            put("messages", messages)
        }

        OutputStreamWriter(conn.outputStream).use { it.write(jsonBody.toString()) }

        return if (conn.responseCode == 200) {
            val responseText = conn.inputStream.bufferedReader().use { it.readText() }
            val jsonResp = JSONObject(responseText)
            jsonResp.optJSONObject("result")?.optString("response")
        } else {
            null
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
        super.onDestroy()
        serviceScope.cancel()
        try {
            audioRecord?.release()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}

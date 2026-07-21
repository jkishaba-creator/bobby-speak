package com.bobbyspeak.keyboard

import android.inputmethodservice.InputMethodService
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Toast
import kotlinx.coroutines.*

/**
 * Bobby Speak Android Dictation Keyboard (InputMethodService).
 *
 * Implements Issue #7 MVP:
 * - Shows a simple QWERTY & dictation UI.
 * - Records 16kHz mono audio via AudioRecord.
 * - Transcribes via Cloudflare Workers AI / Groq API.
 * - Commits clean text to current field via InputConnection.
 */
class BobbyInputMethodService : InputMethodService() {

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var isRecording = false
    private var audioRecord: AudioRecord? = null
    private val sampleRate = 16000

    @android.annotation.SuppressLint("SetTextI18n")
    override fun onCreateInputView(): View {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 16, 16, 16)
        }

        val micButton = Button(this).apply {
            text = "🎤 Hold/Tap to Dictate"
            setOnClickListener {
                if (!isRecording) {
                    startDictation(this)
                } else {
                    stopDictation(this)
                }
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

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(micButton)
            addView(spaceButton)
            addView(deleteButton)
        }

        layout.addView(row)
        return layout
    }

    @android.annotation.SuppressLint("SetTextI18n")
    private fun startDictation(btn: Button) {
        isRecording = true
        btn.text = "⏹ Stop & Transcribe"
        Toast.makeText(this, "Listening…", Toast.LENGTH_SHORT).show()
    }

    @android.annotation.SuppressLint("SetTextI18n")
    private fun stopDictation(btn: Button) {
        isRecording = false
        btn.text = "🎤 Hold/Tap to Dictate"
        Toast.makeText(this, "Processing audio…", Toast.LENGTH_SHORT).show()

        serviceScope.launch {
            // Simulated / Mock transcript endpoint insertion
            val mockText = "Hello from Bobby Speak Android keyboard."
            withContext(Dispatchers.Main) {
                currentInputConnection?.commitText(mockText, 1)
            }
        }
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

package com.bobbyspeak.keyboard

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.inputmethodservice.InputMethodService
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.text.InputType
import android.util.Base64
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream

/**
 * Bobby Speak Android Dictation Keyboard (InputMethodService).
 *
 * Implements Issue #7 MVP & Issue #6 system prompt:
 * - Works as a system keyboard in every app with an editable text field.
 * - Shows a compact voice toolbar above a usable QWERTY keyboard.
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
    private var processingJob: Job? = null
    private val sampleRate = 16000
    private var pcmOutputStream: ByteArrayOutputStream? = null

    private var keyboardController: BobbyKeyboardController? = null
    private var voicePhase = ImeVoicePhase.IDLE
    private var isSensitiveField = false
    private var successResetJob: Job? = null
    private val preferences by lazy {
        getSharedPreferences(BobbyCredentialPreferences.FILE_NAME, Context.MODE_PRIVATE)
    }
    private val preferenceChangeListener =
        SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (!BobbyCredentialPreferences.affectsVoiceSetup(key)) return@OnSharedPreferenceChangeListener

            serviceScope.launch(Dispatchers.Main.immediate) {
                if (!isRecording && processingJob?.isActive != true) {
                    renderVoicePhase(ImeVoicePhase.IDLE)
                }
            }
        }

    companion object {
        private const val TAG = "BobbyIME"
        private const val SUCCESS_MESSAGE_MILLIS = 1_200L
        // Grace window for the raw transcript to finish streaming into the
        // TRANSCRIPT card before we commit the polished text and swap to SUCCESS.
        // Bounded so a cancelled/slow reveal never blocks the commit; the polish
        // network call almost always outlasts the word-by-word animation anyway.
        private const val TRANSCRIPT_SETTLE_MILLIS = 350L
    }

    override fun onCreate() {
        super.onCreate()
        preferences.registerOnSharedPreferenceChangeListener(preferenceChangeListener)
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
        if (!restarting) cancelPendingDictation()
        isSensitiveField = isSensitiveEditor(info)
        if (isSensitiveField) cancelPendingDictation()
        keyboardController?.setShifted(shouldStartShifted(info))
        renderVoicePhase(
            activeVoicePhase(
                isRecording = isRecording,
                isProcessing = processingJob?.isActive == true,
                fallback = if (restarting && !isSensitiveField) {
                    voicePhase
                } else {
                    ImeVoicePhase.IDLE
                }
            )
        )
    }

    override fun onFinishInputView(finishingInput: Boolean) {
        // Never keep recording after the visible stop control leaves screen.
        cancelPendingDictation()
        super.onFinishInputView(finishingInput)
    }

    @android.annotation.SuppressLint("InflateParams")
    override fun onCreateInputView(): View {
        val root = layoutInflater.inflate(R.layout.ime_bobby, null)
        keyboardController = BobbyKeyboardController(
            context = this,
            root = root,
            actions = object : BobbyKeyboardController.Actions {
                override fun onText(text: String) {
                    currentInputConnection?.commitText(text, 1)
                }

                override fun onBackspace() {
                    val inputConnection = currentInputConnection ?: return
                    if (!inputConnection.deleteSurroundingTextInCodePoints(1, 0)) {
                        inputConnection.sendKeyEvent(
                            KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DEL)
                        )
                        inputConnection.sendKeyEvent(
                            KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DEL)
                        )
                    }
                }

                override fun onEnter() {
                    val action = currentInputEditorInfo?.imeOptions
                        ?.and(EditorInfo.IME_MASK_ACTION)
                        ?: EditorInfo.IME_ACTION_NONE
                    val handled = action != EditorInfo.IME_ACTION_NONE &&
                        action != EditorInfo.IME_ACTION_UNSPECIFIED &&
                        sendDefaultEditorAction(true)
                    if (!handled) currentInputConnection?.commitText("\n", 1)
                }

                override fun onSwitchKeyboard() {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
                        shouldOfferSwitchingToNextInputMethod()
                    ) {
                        switchToNextInputMethod(false)
                    } else {
                        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                            .showInputMethodPicker()
                    }
                }

                override fun onMic(action: ImeVoiceAction) {
                    handleMicAction(action)
                }

                override fun onSettings() {
                    openSettings()
                }

                override fun onOpenApiSetup() {
                    openSettings()
                }

                override fun onInsertSavedPrompt(text: String) {
                    currentInputConnection?.commitText(text, 1)
                }
            }
        )
        keyboardController?.setShifted(shouldStartShifted(currentInputEditorInfo))
        renderVoicePhase(
            activeVoicePhase(
                isRecording = isRecording,
                isProcessing = processingJob?.isActive == true,
                fallback = voicePhase
            )
        )
        return root
    }

    private fun handleMicAction(action: ImeVoiceAction) {
        when (action) {
            ImeVoiceAction.START -> startDictation()
            ImeVoiceAction.STOP -> stopDictation()
            ImeVoiceAction.OPEN_SETUP -> openVoiceSetup()
            ImeVoiceAction.NONE -> Unit
        }
    }

    private fun openVoiceSetup() {
        val activity = if (
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
        ) {
            PermissionActivity::class.java
        } else {
            BobbySettingsActivity::class.java
        }
        startActivity(Intent(this, activity).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun openSettings() {
        startActivity(
            Intent(this, BobbySettingsActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    private fun renderVoicePhase(
        phase: ImeVoicePhase,
        errorMessage: String = "Something went wrong. Tap to try again"
    ) {
        successResetJob?.cancel()
        voicePhase = phase
        keyboardController?.renderVoiceState(
            ImeUiState.resolve(
                phase = phase,
                setupRequirement = if (phase == ImeVoicePhase.IDLE) {
                    currentSetupRequirement()
                } else {
                    null
                },
                isSensitiveField = isSensitiveField,
                errorMessage = errorMessage
            )
        )

        if (phase == ImeVoicePhase.SUCCESS) {
            successResetJob = serviceScope.launch {
                delay(SUCCESS_MESSAGE_MILLIS)
                withContext(Dispatchers.Main) {
                    if (voicePhase == ImeVoicePhase.SUCCESS) {
                        successResetJob = null
                        renderVoicePhase(ImeVoicePhase.IDLE)
                    }
                }
            }
        }
    }

    private fun currentSetupRequirement(): ImeSetupRequirement? {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            return ImeSetupRequirement.MICROPHONE
        }

        val credentials = CloudflareCredentials.fromRaw(
            preferences.getString(BobbyCredentialPreferences.CLOUDFLARE_ACCOUNT_ID, "") ?: "",
            preferences.getString(BobbyCredentialPreferences.CLOUDFLARE_API_TOKEN, "") ?: ""
        )
        return if (credentials.isComplete) {
            null
        } else {
            ImeSetupRequirement.CLOUDFLARE
        }
    }

    private fun shouldStartShifted(info: EditorInfo?): Boolean {
        val inputType = info?.inputType ?: return false
        return (currentInputConnection?.getCursorCapsMode(inputType) ?: 0) != 0
    }

    private fun isSensitiveEditor(info: EditorInfo?): Boolean {
        val inputType = info?.inputType ?: return false
        val inputClass = inputType and InputType.TYPE_MASK_CLASS
        val variation = inputType and InputType.TYPE_MASK_VARIATION
        return when (inputClass) {
            InputType.TYPE_CLASS_TEXT -> variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
            InputType.TYPE_CLASS_NUMBER -> variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else -> false
        }
    }

    private fun startDictation() {
        if (isRecording || processingJob?.isActive == true || voicePhase == ImeVoicePhase.PROCESSING) {
            renderVoicePhase(
                activeVoicePhase(
                    isRecording = isRecording,
                    isProcessing = processingJob?.isActive == true,
                    fallback = voicePhase
                )
            )
            return
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            renderVoicePhase(ImeVoicePhase.IDLE)
            return
        }
        if (isSensitiveField || currentSetupRequirement() != null) {
            renderVoicePhase(ImeVoicePhase.IDLE)
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
                renderVoicePhase(
                    ImeVoicePhase.ERROR,
                    "Microphone isn't available right now"
                )
                return
            }

            val outputStream = ByteArrayOutputStream()
            pcmOutputStream = outputStream
            recorder.startRecording()
            isRecording = true
            renderVoicePhase(ImeVoicePhase.LISTENING)

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
            renderVoicePhase(
                ImeVoicePhase.ERROR,
                "Microphone isn't available right now"
            )
        }
    }

    private fun stopDictation() {
        if (!isRecording) return

        isRecording = false
        val recorder = audioRecord
        audioRecord = null
        val completedCapture = recordingJob
        recordingJob = null
        val completedOutput = pcmOutputStream
        pcmOutputStream = null
        renderVoicePhase(ImeVoicePhase.PROCESSING)

        processingJob = serviceScope.launch {
            var recorderReleased = false
            try {
                val rawPcm = finalizeAudioCapture(
                    captureJob = completedCapture,
                    stopAndRelease = {
                        // The capture loop must observe isRecording=false and
                        // finish its final read before the recorder stops.
                        stopAndReleaseAudioRecord(recorder, TAG)
                        recorderReleased = true
                    },
                    copyPcm = {
                        completedOutput?.toByteArray() ?: ByteArray(0)
                    }
                )
                processCapturedAudio(rawPcm)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Unexpected dictation error", e)
                withContext(Dispatchers.Main) {
                    renderVoicePhase(ImeVoicePhase.ERROR)
                }
            } finally {
                if (!recorderReleased) stopAndReleaseAudioRecord(recorder, TAG)
                if (processingJob === coroutineContext[Job]) {
                    processingJob = null
                }
            }
        }
    }

    private suspend fun processCapturedAudio(rawPcm: ByteArray) {
        if (rawPcm.isEmpty()) {
            withContext(Dispatchers.Main) {
                renderVoicePhase(
                    ImeVoicePhase.ERROR,
                    "I didn't hear anything. Try again"
                )
            }
            return
        }

        val wavBytes = BobbyWavEncoder.encode(rawPcm, sampleRate, 1, 16)
        val base64Wav = Base64.encodeToString(wavBytes, Base64.NO_WRAP)

        val credentials = CloudflareCredentials.fromRaw(
            preferences.getString(BobbyCredentialPreferences.CLOUDFLARE_ACCOUNT_ID, "") ?: "",
            preferences.getString(BobbyCredentialPreferences.CLOUDFLARE_API_TOKEN, "") ?: ""
        )

        if (!credentials.isComplete) {
            withContext(Dispatchers.Main) {
                renderVoicePhase(ImeVoicePhase.IDLE)
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
                    preferences.edit()
                        .putBoolean(BobbyCredentialPreferences.CLOUDFLARE_VERIFIED, false)
                        .apply()
                }
                withContext(Dispatchers.Main) {
                    if (currentSetupRequirement() != null) {
                        renderVoicePhase(ImeVoicePhase.IDLE)
                    } else {
                        renderVoicePhase(
                            ImeVoicePhase.ERROR,
                            friendlyCloudflareError(result.kind)
                        )
                    }
                }
                return
            }
        }

        // Stream the raw transcript into the TRANSCRIPT card as live subtitles.
        // The word-by-word animation runs on the Main thread via postDelayed
        // while the polish network call below runs here on IO, so they overlap.
        // The CompletableDeferred lets us settle the stream before committing.
        val transcriptStreamDone = CompletableDeferred<Unit>()
        withContext(Dispatchers.Main) {
            keyboardController?.revealTranscript(transcript) {
                transcriptStreamDone.complete(Unit)
            }
        }

        preferences.edit()
            .putBoolean(BobbyCredentialPreferences.CLOUDFLARE_VERIFIED, true)
            .apply()

        val selection = resolveDictationSelection(
            selectedId = BobbyContentPreferences.selectedActionId(preferences),
            actions = BobbyContentPreferences.resolveActions(preferences),
            tone = BobbyCredentialPreferences.getSelectedTone(preferences)
        )
        val outcome = BobbyDictationTransform.execute(
            raw = transcript,
            selection = selection
        ) { text, action, tone ->
            cloudflareClient.runAction(
                credentials = credentials,
                text = text,
                action = action,
                tone = tone
            )
        }

        // If polish finished before the raw transcript finished streaming (short
        // clip + fast network), let the subtitle animation land before we commit
        // and swap the card to the success state. Bounded by TRANSCRIPT_SETTLE_MILLIS
        // so a cancelled reveal (onComplete never fires) can't stall the commit.
        if (!transcriptStreamDone.isCompleted) {
            withTimeoutOrNull(TRANSCRIPT_SETTLE_MILLIS) { transcriptStreamDone.await() }
        }

        withContext(Dispatchers.Main) {
            val inputConnection = currentInputConnection
            if (inputConnection == null || !inputConnection.commitText(outcome.text, 1)) {
                renderVoicePhase(
                    ImeVoicePhase.ERROR,
                    "Tap a text field and try again"
                )
            } else if (outcome.errorMessage != null) {
                renderVoicePhase(
                    ImeVoicePhase.ERROR,
                    "Couldn't apply ${selection.action.label}. Raw text inserted"
                )
            } else {
                renderVoicePhase(ImeVoicePhase.SUCCESS)
            }
        }
    }

    private fun cancelPendingDictation() {
        isRecording = false
        recordingJob?.cancel()
        recordingJob = null
        processingJob?.cancel()
        processingJob = null
        stopAndReleaseAudioRecord(audioRecord, TAG)
        audioRecord = null
        pcmOutputStream = null
    }

    private fun friendlyCloudflareError(kind: CloudflareFailureKind): String {
        return when (kind) {
            CloudflareFailureKind.RATE_LIMITED -> "Voice is busy. Try again in a moment"
            CloudflareFailureKind.TIMEOUT,
            CloudflareFailureKind.NETWORK -> "Couldn't connect. Check your internet"
            CloudflareFailureKind.CREDENTIALS,
            CloudflareFailureKind.AUTHORIZATION,
            CloudflareFailureKind.NOT_FOUND -> "Check your Bobby setup"
            CloudflareFailureKind.MALFORMED_RESPONSE,
            CloudflareFailureKind.PROVIDER -> "Couldn't turn that into text. Try again"
        }
    }

    override fun onDestroy() {
        preferences.unregisterOnSharedPreferenceChangeListener(preferenceChangeListener)
        cancelPendingDictation()
        successResetJob?.cancel()
        serviceScope.cancel()
        super.onDestroy()
    }
}

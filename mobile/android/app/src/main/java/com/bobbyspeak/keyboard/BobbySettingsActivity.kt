package com.bobbyspeak.keyboard

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.util.Base64
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.view.inputmethod.InputMethodManager
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream

/**
 * Bobby Speak settings + in-app dictation ("Flip" architecture).
 *
 * The activity has two modes that flip between each other:
 *
 *  - **Onboarding Setup Mode**: try-the-keyboard card, 3-step setup, and the
 *    Cloudflare Workers AI credential card. Shown while setup is incomplete, or
 *    when the user taps the ⚙ gear to revisit credentials.
 *  - **Main Dictation Mode**: a big glossy Orb knob, a TRANSCRIPT card, AI Polish
 *    Tone pills, Quick AI Transform pills, and Clear/Copy actions. Tapping the
 *    Orb starts/stops in-app dictation through [CloudflareClient].
 *
 * [updateSetupState] auto-flips to Dictation Mode whenever the keyboard is fully
 * configured (`setupState.isReady == true`) unless the user has explicitly opened
 * setup via the gear.
 *
 * Styled after the Air OS design system at bobby-speak.pages.dev: light canvas,
 * white rounded cards with hairline borders, dark-ink primary pills and white
 * glossy secondary pills. (Brand orange #E8620A is a recording-state accent only
 * — never a button color.)
 */
class BobbySettingsActivity : Activity() {

    private enum class ScreenMode { DICTATION, SETUP }

    private val activityScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val cloudflareClient = CloudflareClient()

    private val preferences by lazy {
        getSharedPreferences(BobbyCredentialPreferences.FILE_NAME, Context.MODE_PRIVATE)
    }

    // --- Shared state -------------------------------------------------------
    private var screenMode = ScreenMode.SETUP
    private var userOpenedSetup = false

    // --- Setup-mode views ---------------------------------------------------
    private lateinit var setupContainer: LinearLayout
    private lateinit var setupStatus: TextView
    private lateinit var enableKeyboardButton: Button
    private lateinit var selectKeyboardButton: Button
    private lateinit var microphoneButton: Button
    private lateinit var testInput: EditText
    private lateinit var goToDictationButton: Button

    // --- Dictation-mode views ----------------------------------------------
    private lateinit var dictationContainer: LinearLayout
    private lateinit var orbView: BobbyOrbView
    private lateinit var orbProgress: ProgressBar
    private lateinit var orbStatus: TextView
    private lateinit var transcriptBody: TextView
    private lateinit var tonePillsRow: LinearLayout
    private lateinit var actionPillsRow: LinearLayout
    private lateinit var savedPromptsSection: LinearLayout
    private lateinit var savedPromptsRow: LinearLayout
    private lateinit var undoPill: TextView
    private lateinit var clearButton: Button
    private lateinit var savePromptButton: Button
    private lateinit var copyButton: Button

    // --- In-app dictation state --------------------------------------------
    @Volatile
    private var isRecording = false
    private var audioRecord: AudioRecord? = null
    private var recordingJob: Job? = null
    private var processingJob: Job? = null
    private val sampleRate = 16000
    private var pcmOutputStream: ByteArrayOutputStream? = null
    private var transcriptRevealRunnable: Runnable? = null
    private var currentTranscript = ""
    private var dictationPhase = ImeVoicePhase.IDLE
    private var selectedTone: ImeTone = ImeTone.NONE
    private var selectedActionId: String = BobbyActionCatalog.clean.id
    private val transcriptHistory = BobbyTranscriptHistory()

    private val ownImeId: String by lazy {
        ComponentName(this, BobbyInputMethodService::class.java).flattenToShortString()
    }
    private val ownImeFullId: String by lazy {
        ComponentName(this, BobbyInputMethodService::class.java).flattenToString()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun LinearLayout.addChild(view: View, topMarginDp: Int = 0) {
        val lp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        if (topMarginDp > 0) lp.topMargin = dp(topMarginDp)
        addView(view, lp)
    }

    private fun airCard(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = getDrawable(R.drawable.bobby_card_background)
        setPadding(dp(20), dp(20), dp(20), dp(20))
    }

    private fun pillButton(
        label: String,
        primary: Boolean = true,
        muted: Boolean = false
    ): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        minHeight = dp(48)
        setPadding(dp(20), 0, dp(20), 0)
        when {
            primary -> {
                background = getDrawable(R.drawable.bobby_button_primary)
                setTextColor(getColor(R.color.bobby_pill_primary_text))
            }
            muted -> {
                background = getDrawable(R.drawable.bobby_button_muted)
                setTextColor(getColor(R.color.bobby_settings_text_muted))
            }
            else -> {
                background = getDrawable(R.drawable.bobby_button_secondary)
                setTextColor(getColor(R.color.bobby_settings_text))
            }
        }
    }

    private fun airInput(hintText: String): EditText = EditText(this).apply {
        hint = hintText
        textSize = 15f
        setTextColor(getColor(R.color.bobby_settings_text))
        setHintTextColor(getColor(R.color.bobby_settings_text_muted))
        background = getDrawable(R.drawable.bobby_input_background)
        setPadding(dp(16), dp(14), dp(16), dp(14))
    }

    private fun fieldLabel(labelText: String): TextView = TextView(this).apply {
        text = labelText
        textSize = 13f
        setTextColor(getColor(R.color.bobby_settings_text_muted))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applySystemBarColors()
        removeLegacyDemoCredentials()

        selectedTone = BobbyCredentialPreferences.getSelectedTone(preferences)
        selectedActionId = BobbyContentPreferences.selectedActionId(preferences)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(24))
            setBackgroundColor(getColor(R.color.bobby_settings_canvas))
        }

        val scrollView = ScrollView(this).apply {
            setBackgroundColor(getColor(R.color.bobby_settings_canvas))
            isFillViewport = true
            addView(layout)
        }

        setupContainer = buildSetupContainer()
        dictationContainer = buildDictationContainer()

        layout.addChild(setupContainer)
        layout.addChild(dictationContainer)

        setContentView(scrollView)
        renderDictation(ImeVoicePhase.IDLE)
        renderTranscriptBody()
        updateSetupState()
    }

    private fun removeLegacyDemoCredentials() {
        val accountId = preferences.getString(
            BobbyCredentialPreferences.CLOUDFLARE_ACCOUNT_ID,
            ""
        )
        val apiToken = preferences.getString(
            BobbyCredentialPreferences.CLOUDFLARE_API_TOKEN,
            ""
        )
        if (accountId == "demo_account_id" && apiToken == "demo_api_token") {
            preferences.edit()
                .remove(BobbyCredentialPreferences.CLOUDFLARE_ACCOUNT_ID)
                .remove(BobbyCredentialPreferences.CLOUDFLARE_API_TOKEN)
                .putBoolean(BobbyCredentialPreferences.CLOUDFLARE_VERIFIED, false)
                .apply()
        }
    }

    @Suppress("DEPRECATION")
    private fun applySystemBarColors() {
        // Blend system bars into the canvas (dark icons on light canvas,
        // light icons when night mode flips the canvas dark).
        actionBar?.hide()
        val canvasColor = getColor(R.color.bobby_settings_canvas)
        window.statusBarColor = canvasColor
        window.navigationBarColor = canvasColor
        val nightMode = resources.configuration.uiMode and
            android.content.res.Configuration.UI_MODE_NIGHT_MASK ==
            android.content.res.Configuration.UI_MODE_NIGHT_YES
        if (!nightMode) {
            var flags = window.decorView.systemUiVisibility or
                android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags = flags or android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            }
            window.decorView.systemUiVisibility = flags
        }
    }

    // =====================================================================
    //  SETUP MODE
    // =====================================================================

    private fun buildSetupContainer(): LinearLayout {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        val title = TextView(this).apply {
            text = getString(R.string.bobby_brand_name)
            textSize = 22f
            setTextColor(getColor(R.color.bobby_settings_text))
            setTypeface(Typeface.create("sans-serif", Typeface.BOLD))
            setPadding(0, 0, 0, dp(8))
        }

        setupStatus = TextView(this).apply {
            textSize = 14f
            setTextColor(getColor(R.color.bobby_settings_warning))
            setPadding(0, 0, 0, dp(4))
        }

        // Card 1: try the keyboard
        testInput = airInput("Try Bobby Speak here").apply {
            contentDescription = "Bobby test input"
            minLines = 2
            inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or
                InputType.TYPE_TEXT_FLAG_MULTI_LINE
            setOnClickListener { postDelayed({ updateSetupState() }, 500) }
        }

        val testKeyboardButton = pillButton(
            "Show Bobby Keyboard",
            primary = false,
            muted = true
        ).apply {
            contentDescription = "Bobby show keyboard"
            setOnClickListener { focusTestInput() }
        }

        val tryCard = airCard().apply {
            addChild(testInput)
            addChild(testKeyboardButton, topMarginDp = 12)
        }

        // Card 2: keyboard setup steps
        enableKeyboardButton = pillButton(
            "1. Enable Bobby Speak",
            primary = false,
            muted = true
        ).apply {
            contentDescription = "Bobby enable input method"
            setOnClickListener { openInputMethodSettings() }
        }

        selectKeyboardButton = pillButton(
            "2. Choose Bobby Speak",
            primary = false,
            muted = true
        ).apply {
            contentDescription = "Bobby choose input method"
            setOnClickListener {
                inputMethodManager().showInputMethodPicker()
                setupStatus.postDelayed({ updateSetupState() }, 750)
            }
        }

        microphoneButton = pillButton(
            "3. Allow Microphone",
            primary = false,
            muted = true
        ).apply {
            setOnClickListener { requestMicrophonePermission() }
        }

        val setupCard = airCard().apply {
            addChild(enableKeyboardButton)
            addChild(selectKeyboardButton, topMarginDp = 10)
            addChild(microphoneButton, topMarginDp = 10)
        }

        // Cloudflare Workers AI credentials
        val cloudflareTitle = TextView(this).apply {
            text = getString(R.string.bobby_setup_credentials_title)
            textSize = 18f
            setTextColor(getColor(R.color.bobby_settings_text))
            setTypeface(Typeface.create("sans-serif", Typeface.BOLD))
        }

        val cloudflareSubtitle = TextView(this).apply {
            text = getString(R.string.bobby_connect_cloudflare)
            textSize = 14f
            setTextColor(getColor(R.color.bobby_settings_text_muted))
        }

        val accountIdLabel = fieldLabel("Cloudflare Account ID:")
        val accountIdInput = airInput("e.g. 1a2b3c4d5e...").apply {
            setText(preferences.getString(BobbyCredentialPreferences.CLOUDFLARE_ACCOUNT_ID, ""))
        }

        val apiTokenLabel = fieldLabel("Cloudflare API Token:")
        val apiTokenInput = airInput("Raw API token (without Bearer)").apply {
            setText(preferences.getString(BobbyCredentialPreferences.CLOUDFLARE_API_TOKEN, ""))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }

        val statusBadge = TextView(this).apply {
            val hasSavedCredentials = !preferences.getString(
                BobbyCredentialPreferences.CLOUDFLARE_ACCOUNT_ID,
                ""
            ).isNullOrBlank() && !preferences.getString(
                BobbyCredentialPreferences.CLOUDFLARE_API_TOKEN,
                ""
            ).isNullOrBlank()
            val credentialsVerified = hasSavedCredentials && preferences.getBoolean(
                BobbyCredentialPreferences.CLOUDFLARE_VERIFIED,
                false
            )
            text = when {
                credentialsVerified -> "🟢 Workers AI credentials verified"
                hasSavedCredentials -> "⚪ Credentials saved — verification not run"
                else -> "⚪ Cloudflare credentials not configured"
            }
            textSize = 14f
            setTextColor(
                getColor(if (credentialsVerified) R.color.bobby_settings_success else R.color.bobby_settings_text_muted)
            )
        }

        val testConnectionButton = pillButton(
            "⚡ Test & Verify Connection",
            primary = false,
            muted = true
        ).apply {
            setOnClickListener {
                val credentials = CloudflareCredentials.fromRaw(
                    accountIdInput.text.toString(),
                    apiTokenInput.text.toString()
                )
                verifyCloudflareCredentials(credentials, statusBadge)
            }
        }

        val saveButton = pillButton(
            "Save Credentials",
            primary = false,
            muted = true
        ).apply {
            setOnClickListener {
                val credentials = CloudflareCredentials.fromRaw(
                    accountIdInput.text.toString(),
                    apiTokenInput.text.toString()
                )

                if (!credentials.isComplete) {
                    statusBadge.text = getString(R.string.bobby_credentials_missing)
                    statusBadge.setTextColor(getColor(R.color.bobby_settings_error))
                    return@setOnClickListener
                }

                val savedCredentials = CloudflareCredentials.fromRaw(
                    preferences.getString(BobbyCredentialPreferences.CLOUDFLARE_ACCOUNT_ID, "") ?: "",
                    preferences.getString(BobbyCredentialPreferences.CLOUDFLARE_API_TOKEN, "") ?: ""
                )
                val remainsVerified = BobbyCredentialPreferences.verificationAfterSave(
                    savedCredentials = savedCredentials,
                    submittedCredentials = credentials,
                    wasVerified = preferences.getBoolean(
                        BobbyCredentialPreferences.CLOUDFLARE_VERIFIED,
                        false
                    )
                )

                preferences.edit()
                    .putString(BobbyCredentialPreferences.CLOUDFLARE_ACCOUNT_ID, credentials.accountId)
                    .putString(BobbyCredentialPreferences.CLOUDFLARE_API_TOKEN, credentials.apiToken)
                    .putBoolean(BobbyCredentialPreferences.CLOUDFLARE_VERIFIED, remainsVerified)
                    .apply()

                accountIdInput.setText(credentials.accountId)
                apiTokenInput.setText(credentials.apiToken)
                statusBadge.text = if (remainsVerified) {
                    "🟢 Workers AI credentials verified"
                } else {
                    "⚪ Credentials saved — tap Verify Workers AI"
                }
                statusBadge.setTextColor(
                    getColor(if (remainsVerified) R.color.bobby_settings_success else R.color.bobby_settings_text_muted)
                )
                updateSetupState()
                Toast.makeText(this@BobbySettingsActivity, "Cloudflare credentials saved", Toast.LENGTH_SHORT).show()
            }
        }

        val cloudflareCard = airCard().apply {
            addChild(cloudflareTitle)
            addChild(cloudflareSubtitle, topMarginDp = 4)
            addChild(accountIdLabel, topMarginDp = 16)
            addChild(accountIdInput, topMarginDp = 6)
            addChild(apiTokenLabel, topMarginDp = 14)
            addChild(apiTokenInput, topMarginDp = 6)
            addChild(statusBadge, topMarginDp = 16)
            addChild(testConnectionButton, topMarginDp = 12)
            addChild(saveButton, topMarginDp = 10)
        }

        val contentTitle = TextView(this).apply {
            text = getString(R.string.bobby_keyboard_content_title)
            textSize = 18f
            setTextColor(getColor(R.color.bobby_settings_text))
            setTypeface(Typeface.create("sans-serif", Typeface.BOLD))
        }
        val contentSubtitle = TextView(this).apply {
            text = getString(R.string.bobby_keyboard_content_subtitle)
            textSize = 14f
            setTextColor(getColor(R.color.bobby_settings_text_muted))
        }
        val manageTypesButton = pillButton(
            "Manage Types",
            primary = false,
            muted = true
        ).apply {
            setOnClickListener { showActionManager() }
        }
        val managePromptsButton = pillButton(
            "Manage saved prompts",
            primary = false,
            muted = true
        ).apply {
            setOnClickListener { showSavedPromptsManager() }
        }
        val contentCard = airCard().apply {
            addChild(contentTitle)
            addChild(contentSubtitle, topMarginDp = 4)
            addChild(manageTypesButton, topMarginDp = 14)
            addChild(managePromptsButton, topMarginDp = 10)
        }

        // Flip CTA: only meaningful once setup is ready.
        goToDictationButton = pillButton(
            "🚀 Go to Dictation View",
            primary = false,
            muted = true
        ).apply {
            visibility = View.GONE
            setOnClickListener {
                userOpenedSetup = false
                flipTo(ScreenMode.DICTATION)
                renderDictation(ImeVoicePhase.IDLE)
            }
        }

        container.addChild(title)
        container.addChild(setupStatus, topMarginDp = 4)
        container.addChild(tryCard, topMarginDp = 16)
        container.addChild(setupCard, topMarginDp = 16)
        container.addChild(cloudflareCard, topMarginDp = 16)
        container.addChild(contentCard, topMarginDp = 16)
        container.addChild(goToDictationButton, topMarginDp = 20)
        return container
    }

    // =====================================================================
    //  DICTATION MODE
    // =====================================================================

    private fun buildDictationContainer(): LinearLayout {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            visibility = View.GONE
        }

        // Header: Bobby Speak wordmark + gear (flip back to setup).
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val logo = TextView(this).apply {
            textSize = 24f
            val s = android.text.SpannableString("Bobby Speak")
            s.setSpan(
                android.text.style.StyleSpan(Typeface.BOLD),
                0, 5,
                android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
            )
            s.setSpan(
                android.text.style.ForegroundColorSpan(getColor(R.color.bobby_settings_text)),
                0, 5,
                android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
            )
            s.setSpan(
                android.text.style.StyleSpan(Typeface.NORMAL),
                6, 11,
                android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
            )
            s.setSpan(
                android.text.style.ForegroundColorSpan(getColor(R.color.bobby_settings_text_muted)),
                6, 11,
                android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
            )
            text = s
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val gearButton = ImageButton(this).apply {
            contentDescription = "Setup & credentials"
            setImageResource(R.drawable.bobby_ic_sun)
            setBackgroundResource(R.drawable.bobby_button_muted)
            setPadding(dp(10), dp(10), dp(10), dp(10))
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            layoutParams = LinearLayout.LayoutParams(dp(44), dp(44))
            setOnClickListener {
                userOpenedSetup = true
                cancelPendingDictation()
                flipTo(ScreenMode.SETUP)
                updateSetupState()
            }
        }
        header.addView(logo)
        header.addView(gearButton)
        container.addChild(header)

        // Centerpiece: big glossy Orb knob (face + dotted ring) with status.
        orbStatus = TextView(this).apply {
            text = getString(R.string.bobby_idle_voice)
            textSize = 15f
            gravity = Gravity.CENTER
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
            setTextColor(getColor(R.color.bobby_text_secondary))
            setTypeface(Typeface.create("sans-serif", Typeface.BOLD))
            setPadding(0, 0, 0, dp(4))
        }

        val orbRingSize = dp(
            BobbyActivityLayoutGeometry.heroOrbStageSizeDp(
                screenWidthDp = resources.configuration.screenWidthDp,
                screenHeightDp = resources.configuration.screenHeightDp
            )
        )
        val orbFrame = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(orbRingSize, orbRingSize).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = dp(8)
            }
        }
        orbView = BobbyOrbView(this).apply {
            layoutParams = FrameLayout.LayoutParams(orbRingSize, orbRingSize)
            contentDescription = getString(R.string.bobby_start_voice)
            setOnClickListener { onOrbTapped() }
        }
        orbProgress = ProgressBar(this).apply {
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(dp(32), dp(32)).apply {
                gravity = Gravity.CENTER
            }
        }
        orbFrame.addView(orbView)
        orbFrame.addView(orbProgress)

        val statusDotsRow = buildStatusDots()

        container.addView(orbFrame)
        container.addChild(statusDotsRow, topMarginDp = 12)
        container.addChild(orbStatus, topMarginDp = 12)

        // TRANSCRIPT card.
        val transcriptLabel = TextView(this).apply {
            text = getString(R.string.bobby_transcript_label)
            textSize = 13f
            setTextColor(getColor(R.color.bobby_settings_text_muted))
            setTypeface(Typeface.create("sans-serif", Typeface.BOLD))
            letterSpacing = 0.08f
        }
        transcriptBody = TextView(this).apply {
            textSize = 16f
            setTextColor(getColor(R.color.bobby_text_primary))
            setPadding(0, dp(10), 0, dp(2))
            minHeight = dp(140)
            minLines = 4
            gravity = Gravity.TOP
        }
        val transcriptCard = airCard().apply {
            addChild(transcriptLabel)
            addChild(transcriptBody, topMarginDp = 6)
        }
        container.addChild(transcriptCard, topMarginDp = 20)

        val savedPromptsLabel = TextView(this).apply {
            text = getString(R.string.bobby_saved_label)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setTextColor(getColor(R.color.bobby_settings_text_muted))
            setTypeface(Typeface.create("sans-serif", Typeface.BOLD))
            letterSpacing = 0.12f
        }
        savedPromptsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        savedPromptsSection = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addChild(savedPromptsLabel)
            addChild(horizontalPillsScroll(savedPromptsRow), topMarginDp = 4)
        }
        buildSavedPromptPills()
        container.addChild(savedPromptsSection, topMarginDp = 16)

        // Tone pills row with inline small-caps TONE label.
        tonePillsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        buildTonePills()
        container.addChild(horizontalPillsScroll(tonePillsRow), topMarginDp = 18)

        // Action pills row.
        actionPillsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        buildActionPills()
        container.addChild(horizontalPillsScroll(actionPillsRow), topMarginDp = 8)

        // Bottom actions mirror the web app: Clear, Save, then the primary Copy action.
        val bottomRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        clearButton = pillButton("Clear", primary = false, muted = true).apply {
            layoutParams = LinearLayout.LayoutParams(
                0,
                dp(BobbyActionButtonGeometry.heightDp),
                0.72f
            ).apply {
                setMargins(0, 0, dp(BobbyActionButtonGeometry.gapDp), 0)
            }
            elevation = dp(BobbyActionButtonGeometry.elevationDp).toFloat()
            setOnClickListener {
                cancelTranscriptReveal()
                currentTranscript = ""
                transcriptHistory.clear()
                renderTranscriptBody()
                renderUndoPill()
                renderDictation(ImeVoicePhase.IDLE)
            }
        }
        savePromptButton = pillButton("Save", primary = false, muted = true).apply {
            layoutParams = LinearLayout.LayoutParams(
                0,
                dp(BobbyActionButtonGeometry.heightDp),
                0.72f
            ).apply {
                setMargins(0, 0, dp(BobbyActionButtonGeometry.gapDp), 0)
            }
            elevation = dp(BobbyActionButtonGeometry.elevationDp).toFloat()
            setOnClickListener { showSavedPromptEditor() }
        }
        copyButton = pillButton("Copy", primary = true).apply {
            layoutParams = LinearLayout.LayoutParams(
                0,
                dp(BobbyActionButtonGeometry.heightDp),
                1f
            )
            elevation = dp(BobbyActionButtonGeometry.elevationDp).toFloat()
            setOnClickListener { copyTranscript() }
        }
        bottomRow.addView(clearButton)
        bottomRow.addView(savePromptButton)
        bottomRow.addView(copyButton)
        container.addView(bottomRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(20) })

        return container
    }

    private val statusDotViews = mutableListOf<View>()

    private fun buildStatusDots(): LinearLayout {
        statusDotViews.clear()
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_HORIZONTAL or Gravity.BOTTOM
            minimumHeight = dp(BobbyOrbLevelGeometry.rowHeightDp)
            val dotWidth = dp(BobbyOrbLevelGeometry.barWidthDp)
            val dotHeight = dp(BobbyOrbLevelGeometry.idleHeightDp)
            val dotGap = dp(BobbyOrbLevelGeometry.gapDp)
            for (i in 0 until BobbyOrbLevelGeometry.count) {
                val dot = View(this@BobbySettingsActivity).apply {
                    background = getDrawable(R.drawable.bobby_dot_circle)
                    backgroundTintList = android.content.res.ColorStateList.valueOf(
                        getColor(R.color.bobby_settings_text_muted)
                    )
                    val lp = LinearLayout.LayoutParams(dotWidth, dotHeight).apply {
                        if (i > 0) leftMargin = dotGap
                    }
                    layoutParams = lp
                }
                statusDotViews.add(dot)
                addView(dot)
            }
        }
    }

    private fun horizontalPillsScroll(row: LinearLayout): HorizontalScrollView {
        return HorizontalScrollView(this).apply {
            isFillViewport = false
            isHorizontalScrollBarEnabled = false
            clipToPadding = false
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(row)
        }
    }

    private fun buildTonePills() {
        tonePillsRow.removeAllViews()
        val inlineToneLabel = TextView(this).apply {
            text = getString(R.string.bobby_tone_label)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setTextColor(getColor(R.color.bobby_settings_text_muted))
            setTypeface(Typeface.create("sans-serif", Typeface.BOLD))
            letterSpacing = 0.12f
            isAllCaps = true
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                dp(36)
            ).apply {
                setMargins(dp(4), dp(4), dp(10), dp(4))
                gravity = Gravity.CENTER_VERTICAL
            }
            layoutParams = lp
        }
        tonePillsRow.addView(inlineToneLabel)

        ImeTone.entries.forEach { tone ->
            val pill = makePill(tone.label)
            pill.setOnClickListener {
                it.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                selectedTone = tone
                BobbyCredentialPreferences.setSelectedTone(preferences, tone)
                renderTonePills()
            }
            tonePillsRow.addView(pill)
        }
        renderTonePills()
    }

    private fun buildActionPills() {
        actionPillsRow.removeAllViews()
        val actions = BobbyContentPreferences.resolveActions(preferences)
        selectedActionId = BobbyContentPreferences.normalizeSelectedActionId(
            selectedActionId,
            actions
        )
        BobbyContentPreferences.setSelectedActionId(preferences, selectedActionId)
        actions.forEach { action ->
            val pill = makePill(action.label)
            pill.tag = action.id
            pill.contentDescription = "${action.label}: ${action.hint}"
            pill.setOnClickListener {
                it.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                selectedActionId = action.id
                BobbyContentPreferences.setSelectedActionId(preferences, action.id)
                renderActionPills()
                applyAction(action)
            }
            actionPillsRow.addView(pill)
        }
        val plusPill = makePill("+").apply {
            contentDescription = "Manage custom Types"
            setOnClickListener {
                it.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                showActionManager()
            }
        }
        actionPillsRow.addView(plusPill)
        undoPill = makePill("Undo").apply {
            contentDescription = "Undo last transform"
            setOnClickListener {
                transcriptHistory.takeUndo()?.let { previous ->
                    currentTranscript = previous
                    copyTranscript(showToast = false)
                    renderTranscriptBody()
                    renderDictation(ImeVoicePhase.IDLE, "Last transform undone — copied")
                }
                renderUndoPill()
            }
        }
        actionPillsRow.addView(undoPill)
        renderActionPills()
        renderUndoPill()
    }

    private fun renderTonePills() {
        for (index in 1 until tonePillsRow.childCount) {
            val child = tonePillsRow.getChildAt(index) as TextView
            val tone = ImeTone.entries[index - 1]
            stylePill(child, tone == selectedTone)
        }
    }

    private fun renderActionPills() {
        for (index in 0 until actionPillsRow.childCount) {
            val child = actionPillsRow.getChildAt(index) as TextView
            val actionId = child.tag as? String ?: continue
            stylePill(child, actionId == selectedActionId)
        }
    }

    private fun renderUndoPill() {
        if (::undoPill.isInitialized) {
            undoPill.visibility = if (transcriptHistory.canUndo) View.VISIBLE else View.GONE
        }
    }

    private fun buildSavedPromptPills() {
        savedPromptsRow.removeAllViews()
        val prompts = BobbyContentPreferences.savedPrompts(preferences)
        savedPromptsSection.visibility = if (prompts.isEmpty()) View.GONE else View.VISIBLE
        prompts.forEach { prompt ->
            val pill = makePill(prompt.name)
            pill.contentDescription = "Use saved prompt ${prompt.name}"
            pill.setOnClickListener {
                currentTranscript = prompt.text
                transcriptHistory.clear()
                copyTranscript(showToast = false)
                renderTranscriptBody()
                renderUndoPill()
                renderDictation(ImeVoicePhase.IDLE, "Saved prompt loaded — copied")
            }
            savedPromptsRow.addView(pill)
        }
    }

    private fun makePill(label: String): TextView {
        val margin = dp(4)
        return TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                dp(BobbyTouchTargetGeometry.minimumDp)
            ).apply {
                setMargins(margin, margin, margin, margin)
            }
            background = getDrawable(R.drawable.bobby_pill_default)
            elevation = dp(2).toFloat()
            gravity = Gravity.CENTER
            includeFontPadding = false
            isClickable = true
            isFocusable = true
            isSingleLine = true
            minimumWidth = dp(BobbyTouchTargetGeometry.minimumDp)
            setPadding(dp(12), dp(6), dp(12), dp(6))
            text = label
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTypeface(Typeface.create("sans-serif", Typeface.NORMAL))
        }
    }

    private fun stylePill(view: TextView, selected: Boolean) {
        view.background = getDrawable(
            if (selected) R.drawable.bobby_pill_selected else R.drawable.bobby_pill_default
        )
        view.setTextColor(
            getColor(
                if (selected) R.color.bobby_pill_primary_text else R.color.bobby_settings_text_muted
            )
        )
    }

    private fun dialogBody(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(20), dp(8), dp(20), dp(8))
    }

    private fun alertBuilder(): AlertDialog.Builder = AlertDialog.Builder(
        this,
        android.R.style.Theme_Material_Light_Dialog_Alert
    )

    private fun tintDialogButtons(dialog: AlertDialog) {
        listOf(
            AlertDialog.BUTTON_POSITIVE,
            AlertDialog.BUTTON_NEGATIVE,
            AlertDialog.BUTTON_NEUTRAL
        ).forEach { button ->
            dialog.getButton(button)?.setTextColor(getColor(R.color.bobby_text_secondary))
        }
    }

    private fun compactMutedButton(label: String): Button = pillButton(
        label,
        primary = false,
        muted = true
    ).apply {
        minHeight = dp(BobbyTouchTargetGeometry.minimumDp)
        minimumWidth = dp(BobbyTouchTargetGeometry.minimumDp)
        setPadding(dp(12), 0, dp(12), 0)
        textSize = 13f
    }

    private fun refreshContentControls() {
        selectedActionId = BobbyContentPreferences.selectedActionId(preferences)
        if (::actionPillsRow.isInitialized) buildActionPills()
        if (::savedPromptsRow.isInitialized) buildSavedPromptPills()
    }

    private fun showActionManager() {
        val customActions = BobbyContentPreferences.customActions(preferences)
        val hiddenIds = BobbyContentPreferences.hiddenActionIds(preferences)
        val allActions = BobbyActionCatalog.resolve(
            customActions = customActions,
            hiddenIds = emptySet(),
            orderedIds = BobbyContentPreferences.actionOrder(preferences)
        )
        val orderedIds = allActions.map { it.id }.toMutableList()
        lateinit var dialog: AlertDialog

        val body = dialogBody()
        body.addChild(TextView(this).apply {
            text = getString(R.string.bobby_type_management_hint)
            textSize = 14f
            setTextColor(getColor(R.color.bobby_settings_text_muted))
        })
        body.addChild(compactMutedButton("+ Add custom Type").apply {
            setOnClickListener {
                dialog.dismiss()
                showCustomActionEditor()
            }
        }, topMarginDp = 12)

        allActions.forEachIndexed { index, action ->
            val item = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = getDrawable(R.drawable.bobby_card_background)
                setPadding(dp(14), dp(12), dp(14), dp(12))
            }
            item.addChild(TextView(this).apply {
                text = action.label
                textSize = 15f
                setTypeface(Typeface.create("sans-serif", Typeface.BOLD))
                setTextColor(getColor(R.color.bobby_settings_text))
            })
            item.addChild(TextView(this).apply {
                text = action.hint
                maxLines = 2
                textSize = 13f
                setTextColor(getColor(R.color.bobby_settings_text_muted))
            }, topMarginDp = 2)

            val controls = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
            }
            controls.addView(compactMutedButton("↑").apply {
                isEnabled = index > 0
                contentDescription = "Move ${action.label} up"
                setOnClickListener {
                    orderedIds[index] = orderedIds[index - 1].also {
                        orderedIds[index - 1] = orderedIds[index]
                    }
                    BobbyContentPreferences.setActionOrder(preferences, orderedIds)
                    dialog.dismiss()
                    refreshContentControls()
                    showActionManager()
                }
            })
            controls.addView(compactMutedButton("↓").apply {
                isEnabled = index < orderedIds.lastIndex
                contentDescription = "Move ${action.label} down"
                setOnClickListener {
                    orderedIds[index] = orderedIds[index + 1].also {
                        orderedIds[index + 1] = orderedIds[index]
                    }
                    BobbyContentPreferences.setActionOrder(preferences, orderedIds)
                    dialog.dismiss()
                    refreshContentControls()
                    showActionManager()
                }
            })
            controls.addView(compactMutedButton(
                if (action.id in hiddenIds) "Show" else "Hide"
            ).apply {
                setOnClickListener {
                    val updated = hiddenIds.toMutableSet()
                    if (action.id in updated) {
                        updated.remove(action.id)
                    } else {
                        val visibleCount = allActions.count { it.id !in hiddenIds }
                        if (visibleCount <= 1) {
                            Toast.makeText(
                                this@BobbySettingsActivity,
                                "Keep at least one Type visible",
                                Toast.LENGTH_SHORT
                            ).show()
                            return@setOnClickListener
                        }
                        updated.add(action.id)
                    }
                    BobbyContentPreferences.setHiddenActionIds(preferences, updated)
                    dialog.dismiss()
                    refreshContentControls()
                    showActionManager()
                }
            })
            if (action.custom) {
                val rawId = action.id.removePrefix(BobbyActionCatalog.CUSTOM_PREFIX)
                val custom = customActions.firstOrNull { it.id == rawId }
                if (custom != null) {
                    controls.addView(compactMutedButton("Edit").apply {
                        contentDescription = "Edit ${action.label}"
                        setOnClickListener {
                            dialog.dismiss()
                            showCustomActionEditor(custom)
                        }
                    })
                    controls.addView(compactMutedButton("Delete").apply {
                        contentDescription = "Delete ${action.label}"
                        setOnClickListener {
                            dialog.dismiss()
                            confirmDeleteCustomAction(custom)
                        }
                    })
                }
            }
            item.addChild(horizontalPillsScroll(controls), topMarginDp = 8)
            body.addChild(item, topMarginDp = 10)
        }

        val scroll = ScrollView(this).apply { addView(body) }
        dialog = alertBuilder()
            .setTitle("Manage Types")
            .setView(scroll)
            .setNegativeButton("Done", null)
            .create()
        dialog.show()
        tintDialogButtons(dialog)
    }

    private fun showCustomActionEditor(existing: BobbyCustomAction? = null) {
        val body = dialogBody()
        val labelInput = airInput("Type label").apply {
            setText(existing?.label.orEmpty())
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }
        val promptInput = airInput("What should this Type do?").apply {
            setText(existing?.prompt.orEmpty())
            minLines = 4
            gravity = Gravity.TOP
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }
        val error = fieldLabel("")
        body.addChild(fieldLabel("Label — ${BobbyActionCatalog.MAX_LABEL_LENGTH} characters max"))
        body.addChild(labelInput, topMarginDp = 6)
        body.addChild(fieldLabel("Instruction — ${BobbyActionCatalog.MAX_PROMPT_LENGTH} characters max"), topMarginDp = 12)
        body.addChild(promptInput, topMarginDp = 6)
        body.addChild(error, topMarginDp = 8)

        val dialog = alertBuilder()
            .setTitle(if (existing == null) "New custom Type" else "Edit custom Type")
            .setView(body)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val values = BobbyContentPreferences.customActions(preferences)
                val validation = BobbyActionCatalog.validateCustom(
                    id = existing?.id,
                    label = labelInput.text.toString(),
                    prompt = promptInput.text.toString(),
                    existing = values
                )
                val value = validation.value
                if (!validation.isValid || value == null) {
                    error.text = validation.error.orEmpty()
                    error.setTextColor(getColor(R.color.bobby_settings_error))
                    return@setOnClickListener
                }
                val updated = values.toMutableList()
                val existingIndex = updated.indexOfFirst { it.id == value.id }
                if (existingIndex >= 0) updated[existingIndex] = value else updated += value
                BobbyContentPreferences.setCustomActions(preferences, updated)
                selectedActionId = BobbyActionCatalog.CUSTOM_PREFIX + value.id
                BobbyContentPreferences.setSelectedActionId(preferences, selectedActionId)
                dialog.dismiss()
                refreshContentControls()
                showActionManager()
            }
        }
        dialog.show()
        tintDialogButtons(dialog)
    }

    private fun confirmDeleteCustomAction(action: BobbyCustomAction) {
        val dialog = alertBuilder()
            .setTitle("Delete ${action.label}?")
            .setMessage("This removes the custom Type from Bobby Speak.")
            .setNegativeButton("Cancel") { _, _ -> showActionManager() }
            .setPositiveButton("Delete") { _, _ ->
                BobbyContentPreferences.setCustomActions(
                    preferences,
                    BobbyContentPreferences.customActions(preferences)
                        .filterNot { it.id == action.id }
                )
                val actionId = BobbyActionCatalog.CUSTOM_PREFIX + action.id
                BobbyContentPreferences.setHiddenActionIds(
                    preferences,
                    BobbyContentPreferences.hiddenActionIds(preferences) - actionId
                )
                BobbyContentPreferences.setActionOrder(
                    preferences,
                    BobbyContentPreferences.actionOrder(preferences).filterNot { it == actionId }
                )
                refreshContentControls()
                showActionManager()
            }
            .create()
        dialog.show()
        tintDialogButtons(dialog)
    }

    private fun showSavedPromptEditor(existing: BobbySavedPrompt? = null) {
        val textToSave = existing?.text ?: currentTranscript
        val body = dialogBody()
        val nameInput = airInput("Prompt name").apply {
            setText(existing?.name ?: BobbyPromptCatalog.suggestName(textToSave))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }
        val textInput = airInput("Saved prompt text").apply {
            setText(textToSave)
            minLines = 4
            gravity = Gravity.TOP
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }
        val error = fieldLabel("")
        body.addChild(fieldLabel("Name — ${BobbyPromptCatalog.MAX_NAME_LENGTH} characters max"))
        body.addChild(nameInput, topMarginDp = 6)
        body.addChild(fieldLabel("Prompt text"), topMarginDp = 12)
        body.addChild(textInput, topMarginDp = 6)
        body.addChild(error, topMarginDp = 8)

        val dialog = alertBuilder()
            .setTitle(if (existing == null) "Save prompt" else "Edit saved prompt")
            .setView(body)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val values = BobbyContentPreferences.savedPrompts(preferences)
                val validation = BobbyPromptCatalog.validate(
                    id = existing?.id,
                    name = nameInput.text.toString(),
                    text = textInput.text.toString(),
                    existing = values
                )
                val value = validation.value
                if (!validation.isValid || value == null) {
                    error.text = validation.error.orEmpty()
                    error.setTextColor(getColor(R.color.bobby_settings_error))
                    return@setOnClickListener
                }
                val updated = values.toMutableList()
                val existingIndex = updated.indexOfFirst { it.id == value.id }
                if (existingIndex >= 0) updated[existingIndex] = value else updated += value
                BobbyContentPreferences.setSavedPrompts(preferences, updated)
                dialog.dismiss()
                refreshContentControls()
                Toast.makeText(this, "Prompt saved", Toast.LENGTH_SHORT).show()
            }
        }
        dialog.show()
        tintDialogButtons(dialog)
    }

    private fun showSavedPromptsManager() {
        val prompts = BobbyContentPreferences.savedPrompts(preferences)
        lateinit var dialog: AlertDialog
        val body = dialogBody()
        body.addChild(compactMutedButton("+ Add saved prompt").apply {
            setOnClickListener {
                dialog.dismiss()
                showSavedPromptEditor()
            }
        })
        if (prompts.isEmpty()) {
            body.addChild(TextView(this).apply {
                text = getString(R.string.bobby_no_saved_prompts)
                textSize = 14f
                setTextColor(getColor(R.color.bobby_settings_text_muted))
            }, topMarginDp = 14)
        }
        prompts.forEach { prompt ->
            val item = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = getDrawable(R.drawable.bobby_card_background)
                setPadding(dp(14), dp(12), dp(14), dp(12))
            }
            item.addChild(TextView(this).apply {
                text = prompt.name
                textSize = 15f
                setTypeface(Typeface.create("sans-serif", Typeface.BOLD))
                setTextColor(getColor(R.color.bobby_settings_text))
            })
            item.addChild(TextView(this).apply {
                text = prompt.text
                maxLines = 2
                textSize = 13f
                setTextColor(getColor(R.color.bobby_settings_text_muted))
            }, topMarginDp = 3)
            val controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            controls.addView(compactMutedButton("Use").apply {
                contentDescription = "Use saved prompt ${prompt.name}"
                setOnClickListener {
                    currentTranscript = prompt.text
                    transcriptHistory.clear()
                    copyTranscript(showToast = false)
                    renderTranscriptBody()
                    renderUndoPill()
                    dialog.dismiss()
                    userOpenedSetup = false
                    flipTo(ScreenMode.DICTATION)
                }
            })
            controls.addView(compactMutedButton("Edit").apply {
                contentDescription = "Edit saved prompt ${prompt.name}"
                setOnClickListener {
                    dialog.dismiss()
                    showSavedPromptEditor(prompt)
                }
            })
            controls.addView(compactMutedButton("Delete").apply {
                contentDescription = "Delete saved prompt ${prompt.name}"
                setOnClickListener {
                    BobbyContentPreferences.setSavedPrompts(
                        preferences,
                        BobbyContentPreferences.savedPrompts(preferences)
                            .filterNot { it.id == prompt.id }
                    )
                    dialog.dismiss()
                    refreshContentControls()
                    showSavedPromptsManager()
                }
            })
            item.addChild(controls, topMarginDp = 8)
            body.addChild(item, topMarginDp = 10)
        }

        val scroll = ScrollView(this).apply { addView(body) }
        dialog = alertBuilder()
            .setTitle("Saved prompts")
            .setView(scroll)
            .setNegativeButton("Done", null)
            .create()
        dialog.show()
        tintDialogButtons(dialog)
    }

    // ---------------------------------------------------------------------
    //  Flip / setup-state reconciliation
    // ---------------------------------------------------------------------

    private fun flipTo(mode: ScreenMode) {
        if (screenMode == mode) return
        screenMode = mode
        val (show, hide) = if (mode == ScreenMode.DICTATION) {
            dictationContainer to setupContainer
        } else {
            setupContainer to dictationContainer
        }
        hide.visibility = View.GONE
        show.visibility = View.VISIBLE
        show.alpha = 0f
        show.animate().alpha(1f).setDuration(180L).start()
    }

    private fun updateSetupState() {
        val enabled = isOwnImeEnabled()
        val selected = isOwnImeSelected()
        val microphoneGranted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        val rawAccountId = preferences.getString(BobbyCredentialPreferences.CLOUDFLARE_ACCOUNT_ID, "") ?: ""
        val rawToken = preferences.getString(BobbyCredentialPreferences.CLOUDFLARE_API_TOKEN, "") ?: ""
        val cloudflareConfigured = rawAccountId.isNotBlank() && rawToken.isNotBlank()
        val cloudflareVerified = cloudflareConfigured && preferences.getBoolean(
            BobbyCredentialPreferences.CLOUDFLARE_VERIFIED,
            false
        )
        val setupState = BobbySetupState(
            imeEnabled = enabled,
            imeSelected = selected,
            microphoneGranted = microphoneGranted,
            cloudflareConfigured = cloudflareConfigured,
            cloudflareVerified = cloudflareVerified
        )
        if (setupState.isReady && !userOpenedSetup && screenMode != ScreenMode.DICTATION) {
            flipTo(ScreenMode.DICTATION)
            renderDictation(ImeVoicePhase.IDLE)
        }

        enableKeyboardButton.text = if (enabled) {
            "✓ 1. Enable Bobby Speak — done"
        } else {
            "1. Enable Bobby Speak"
        }
        selectKeyboardButton.text = if (selected) {
            "✓ 2. Choose Bobby Speak — selected"
        } else {
            "2. Choose Bobby Speak"
        }
        selectKeyboardButton.isEnabled = enabled
        microphoneButton.text = if (microphoneGranted) {
            "✓ 3. Allow Microphone — done"
        } else {
            "3. Allow Microphone"
        }

        setupStatus.text = when (setupState.nextStep) {
            BobbySetupStep.ENABLE_IME -> "Step 1: enable Bobby Speak in Android keyboard settings."
            BobbySetupStep.SELECT_IME -> "Step 2: choose Bobby Speak as the current keyboard."
            BobbySetupStep.GRANT_MICROPHONE -> "Step 3: allow microphone access for dictation."
            BobbySetupStep.CONFIGURE_CLOUDFLARE -> "Step 4: enter and save Cloudflare credentials."
            BobbySetupStep.VERIFY_CLOUDFLARE -> "Step 4: verify the saved Workers AI credentials."
            BobbySetupStep.READY -> "🟢 Bobby Speak is fully configured and ready to dictate."
        }
        setupStatus.setTextColor(
            getColor(if (setupState.isReady) R.color.bobby_settings_success else R.color.bobby_settings_warning)
        )

        // The setup-mode "Go to Dictation View" CTA is only meaningful once ready.
        if (::goToDictationButton.isInitialized) {
            goToDictationButton.visibility = if (setupState.isReady) View.VISIBLE else View.GONE
        }

        // AUTO-FLIP: when fully configured and the user hasn't explicitly opened
        // setup, flip to the Dictation view. If setup is no longer ready, flip
        // back so the user can finish configuring.
        if (setupState.isReady && !userOpenedSetup) {
            if (screenMode != ScreenMode.DICTATION) flipTo(ScreenMode.DICTATION)
        } else if (!setupState.isReady) {
            userOpenedSetup = false
            if (screenMode != ScreenMode.SETUP) flipTo(ScreenMode.SETUP)
        }
    }

    // ---------------------------------------------------------------------
    //  In-app dictation (Orb)
    // ---------------------------------------------------------------------

    private fun onOrbTapped() {
        orbView.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        when (dictationPhase) {
            ImeVoicePhase.LISTENING -> stopDictation()
            ImeVoicePhase.PROCESSING -> Unit // ignore taps mid-flight
            else -> startDictation()
        }
    }

    private fun currentCredentials(): CloudflareCredentials = CloudflareCredentials.fromRaw(
        preferences.getString(BobbyCredentialPreferences.CLOUDFLARE_ACCOUNT_ID, "") ?: "",
        preferences.getString(BobbyCredentialPreferences.CLOUDFLARE_API_TOKEN, "") ?: ""
    )

    private fun startDictation() {
        if (isRecording || processingJob?.isActive == true) return

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            renderDictation(ImeVoicePhase.ERROR, "Allow microphone to use voice")
            return
        }
        val credentials = currentCredentials()
        if (!credentials.isComplete) {
            renderDictation(ImeVoicePhase.ERROR, "Connect Cloudflare credentials first")
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
                renderDictation(
                    ImeVoicePhase.ERROR,
                    "Microphone isn't available right now"
                )
                return
            }

            cancelTranscriptReveal()
            val outputStream = ByteArrayOutputStream()
            pcmOutputStream = outputStream
            recorder.startRecording()
            isRecording = true
            renderDictation(ImeVoicePhase.LISTENING)

            recordingJob = activityScope.launch(Dispatchers.IO) {
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
            renderDictation(
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
        renderDictation(ImeVoicePhase.PROCESSING, "Writing…")

        processingJob = activityScope.launch(Dispatchers.IO) {
            var recorderReleased = false
            try {
                val rawPcm = finalizeAudioCapture(
                    captureJob = completedCapture,
                    stopAndRelease = {
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
                    renderDictation(ImeVoicePhase.ERROR, "Couldn't process audio. Try again")
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
                renderDictation(
                    ImeVoicePhase.ERROR,
                    "I didn't hear anything. Try again"
                )
            }
            return
        }

        val wavBytes = BobbyWavEncoder.encode(rawPcm, sampleRate, 1, 16)
        val base64Wav = Base64.encodeToString(wavBytes, Base64.NO_WRAP)

        val credentials = currentCredentials()
        if (!credentials.isComplete) {
            withContext(Dispatchers.Main) { renderDictation(ImeVoicePhase.IDLE) }
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
                    renderDictation(ImeVoicePhase.ERROR, friendlyCloudflareError(result.kind))
                }
                return
            }
        }

        // A successful transcription re-confirms the credentials.
        preferences.edit()
            .putBoolean(BobbyCredentialPreferences.CLOUDFLARE_VERIFIED, true)
            .apply()

        // Stream the raw transcript into the TRANSCRIPT card like live subtitles
        // while the polish call runs concurrently on IO.
        val transcriptStreamDone = CompletableDeferred<Unit>()
        withContext(Dispatchers.Main) {
            revealTranscript(transcript) { transcriptStreamDone.complete(Unit) }
        }

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

        // If polish finished before the raw stream landed, let the subtitles
        // settle before we swap in the polished text. Bounded so a cancelled
        // reveal can't stall the update.
        if (!transcriptStreamDone.isCompleted) {
            withTimeoutOrNull(TRANSCRIPT_SETTLE_MILLIS) { transcriptStreamDone.await() }
        }

        withContext(Dispatchers.Main) {
            currentTranscript = outcome.text
            transcriptHistory.clear()
            copyTranscript(showToast = false)
            renderTranscriptBody()
            renderUndoPill()
            if (outcome.errorMessage == null) {
                renderDictation(ImeVoicePhase.IDLE, "Done — copied")
            } else {
                renderDictation(
                    ImeVoicePhase.ERROR,
                    "Couldn't apply ${selection.action.label}. Raw transcript copied"
                )
            }
        }
    }

    /**
     * Transforms the current transcript with the chosen Quick AI Transform pill.
     * "Clean" re-applies the selected tone (light cleanup); the others use their
     * dedicated Cloudflare prompts. Runs on IO; updates the card on the Main thread.
     */
    private fun applyAction(action: BobbyTextAction) {
        val text = currentTranscript
        if (text.isBlank()) {
            Toast.makeText(this, "Tap the orb to dictate first", Toast.LENGTH_SHORT).show()
            return
        }
        val credentials = currentCredentials()
        if (!credentials.isComplete) {
            renderDictation(ImeVoicePhase.ERROR, "Connect Cloudflare credentials first")
            return
        }

        renderDictation(ImeVoicePhase.PROCESSING, "Transforming…")
        activityScope.launch {
            val result = withContext(Dispatchers.IO) {
                cloudflareClient.runAction(
                    credentials = credentials,
                    text = text,
                    action = action,
                    tone = selectedTone
                )
            }
            transcriptHistory.recordTransform(text, result)
            renderUndoPill()
            when (result) {
                is CloudflareResult.Success -> {
                    currentTranscript = BobbyDictationTransform.finalText(text, result)
                    copyTranscript(showToast = false)
                    renderTranscriptBody()
                    renderDictation(ImeVoicePhase.IDLE, "Updated — copied")
                }
                is CloudflareResult.Failure -> {
                    renderDictation(
                        ImeVoicePhase.ERROR,
                        friendlyCloudflareError(result.kind)
                    )
                }
            }
        }
    }

    private fun copyTranscript(showToast: Boolean = true) {
        val text = currentTranscript
        if (text.isBlank()) {
            if (showToast) {
                Toast.makeText(this, "Nothing to copy yet", Toast.LENGTH_SHORT).show()
            }
            return
        }
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Bobby Speak transcript", text))
        if (showToast) {
            Toast.makeText(this, "Transcript copied", Toast.LENGTH_SHORT).show()
        }
    }

    private fun renderDictation(
        phase: ImeVoicePhase,
        message: String = defaultStatusFor(phase)
    ) {
        dictationPhase = phase
        orbStatus.text = message
        orbStatus.setTextColor(getColor(statusColor(phase)))

        val recording = phase == ImeVoicePhase.LISTENING
        statusDotViews.forEach { dot ->
            dot.backgroundTintList = android.content.res.ColorStateList.valueOf(
                getColor(if (recording) R.color.bobby_recording else R.color.bobby_settings_text_muted)
            )
        }
        orbView.setPhase(phase)
        orbView.contentDescription = getString(
            if (recording) R.string.bobby_stop_voice else R.string.bobby_start_voice
        )

        val processing = phase == ImeVoicePhase.PROCESSING
        orbProgress.visibility = if (processing) View.VISIBLE else View.GONE
        orbView.isEnabled = !processing
        orbView.alpha = if (processing) 0.82f else 1f
    }

    private fun defaultStatusFor(phase: ImeVoicePhase): String = when (phase) {
        ImeVoicePhase.IDLE -> "Tap to speak"
        ImeVoicePhase.LISTENING -> "Listening…"
        ImeVoicePhase.PROCESSING -> "Writing…"
        ImeVoicePhase.SUCCESS -> "Done — tap to speak again"
        ImeVoicePhase.ERROR -> "Something went wrong. Tap to try again"
    }

    private fun statusColor(phase: ImeVoicePhase): Int = when (phase) {
        ImeVoicePhase.LISTENING -> R.color.bobby_text_primary
        ImeVoicePhase.SUCCESS -> R.color.bobby_success
        ImeVoicePhase.ERROR -> R.color.bobby_error
        ImeVoicePhase.PROCESSING -> R.color.bobby_text_secondary
        ImeVoicePhase.IDLE -> R.color.bobby_text_secondary
    }

    /**
     * Paints [transcriptBody] with either the live transcript (primary ink) or a
     * muted placeholder when empty, mirroring the empty TRANSCRIPT card state.
     */
    private fun renderTranscriptBody() {
        if (currentTranscript.isBlank()) {
            transcriptBody.text = getString(R.string.bobby_empty_transcript)
            transcriptBody.setTextColor(getColor(R.color.bobby_settings_text_muted))
            if (::copyButton.isInitialized) {
                copyButton.background = getDrawable(R.drawable.bobby_button_secondary)
                copyButton.backgroundTintList = android.content.res.ColorStateList.valueOf(
                    getColor(R.color.bobby_copy_disabled_bg)
                )
                copyButton.setTextColor(getColor(R.color.bobby_pill_primary_text))
            }
        } else {
            transcriptBody.text = currentTranscript
            transcriptBody.setTextColor(getColor(R.color.bobby_text_primary))
            if (::copyButton.isInitialized) {
                copyButton.background = getDrawable(R.drawable.bobby_button_primary)
                copyButton.backgroundTintList = null
                copyButton.setTextColor(getColor(R.color.bobby_pill_primary_text))
            }
        }
    }

    /**
     * Reveals [text] word-by-word into the TRANSCRIPT card so the user sees the
     * raw recognition stream like live subtitles while the polish call is in
     * flight. Non-blocking; any in-flight reveal is cancelled first.
     */
    private fun revealTranscript(text: String, onComplete: () -> Unit = {}) {
        cancelTranscriptReveal()
        val words = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        transcriptBody.setTextColor(getColor(R.color.bobby_text_primary))
        if (words.isEmpty() || !transcriptBody.isAttachedToWindow) {
            transcriptBody.text = text
            onComplete()
            return
        }
        val builder = StringBuilder()
        var index = 0
        val step = object : Runnable {
            override fun run() {
                if (!transcriptBody.isAttachedToWindow) return
                if (index >= words.size) {
                    transcriptRevealRunnable = null
                    onComplete()
                    return
                }
                if (builder.isNotEmpty()) builder.append(' ')
                builder.append(words[index])
                transcriptBody.text = builder.toString()
                index++
                transcriptBody.postDelayed(this, REVEAL_STEP_MILLIS)
            }
        }
        transcriptRevealRunnable = step
        transcriptBody.postDelayed(step, REVEAL_STEP_MILLIS)
    }

    private fun cancelTranscriptReveal() {
        transcriptRevealRunnable?.let { transcriptBody.removeCallbacks(it) }
        transcriptRevealRunnable = null
    }

    private fun cancelPendingDictation() {
        isRecording = false
        recordingJob?.cancel()
        recordingJob = null
        processingJob?.cancel()
        processingJob = null
        cancelTranscriptReveal()
        if (::orbView.isInitialized) orbView.setPhase(ImeVoicePhase.IDLE)
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

    // =====================================================================
    //  Setup helpers (unchanged behavior)
    // =====================================================================

    override fun onResume() {
        super.onResume()
        if (::setupStatus.isInitialized) updateSetupState()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && ::setupStatus.isInitialized) {
            setupStatus.postDelayed({ updateSetupState() }, 250)
        }
    }

    override fun onPause() {
        super.onPause()
        // Never keep the mic open when the activity leaves the foreground.
        cancelPendingDictation()
    }

    private fun inputMethodManager(): InputMethodManager {
        return getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    }

    private fun isOwnImeEnabled(): Boolean {
        return inputMethodManager().enabledInputMethodList.any {
            it.packageName == packageName || it.id.startsWith(packageName)
        }
    }

    @Suppress("DEPRECATION")
    private fun isOwnImeSelected(): Boolean {
        val currentImeId = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            inputMethodManager().currentInputMethodInfo?.id
        } else {
            null
        }
        if (currentImeId?.startsWith(packageName) == true) return true

        val selectedSetting = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.DEFAULT_INPUT_METHOD
        )
        return selectedSetting?.startsWith(packageName) == true
    }

    private fun openInputMethodSettings() {
        try {
            startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "Android keyboard settings could not be opened", Toast.LENGTH_LONG).show()
        }
    }

    private fun requestMicrophonePermission() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            updateSetupState()
            return
        }
        requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_RECORD_AUDIO)
    }

    private fun focusTestInput() {
        if (!isOwnImeSelected()) {
            Toast.makeText(this, "Choose Bobby Speak as your keyboard first", Toast.LENGTH_LONG).show()
            inputMethodManager().showInputMethodPicker()
            return
        }

        testInput.requestFocus()
        testInput.post {
            inputMethodManager().showSoftInput(testInput, 0)
            testInput.postDelayed({ updateSetupState() }, 500)
            testInput.postDelayed({ updateSetupState() }, 1_500)
        }
    }

    private fun verifyCloudflareCredentials(
        credentials: CloudflareCredentials,
        badge: TextView
    ) {
        if (!credentials.isComplete) {
            badge.text = getString(R.string.bobby_credentials_missing)
            badge.setTextColor(getColor(R.color.bobby_settings_error))
            return
        }

        badge.text = getString(R.string.bobby_credentials_verifying)
        badge.setTextColor(getColor(R.color.bobby_settings_warning))

        activityScope.launch {
            val result = withContext(Dispatchers.IO) {
                cloudflareClient.verify(credentials)
            }

            when (result) {
                is CloudflareResult.Success -> {
                    preferences.edit()
                        .putString(
                            BobbyCredentialPreferences.CLOUDFLARE_ACCOUNT_ID,
                            credentials.accountId
                        )
                        .putString(
                            BobbyCredentialPreferences.CLOUDFLARE_API_TOKEN,
                            credentials.apiToken
                        )
                        .putBoolean(BobbyCredentialPreferences.CLOUDFLARE_VERIFIED, true)
                        .apply()
                    badge.text = getString(R.string.bobby_credentials_verified)
                    badge.setTextColor(getColor(R.color.bobby_settings_success))
                    updateSetupState()
                }
                is CloudflareResult.Failure -> {
                    preferences.edit()
                        .putBoolean(BobbyCredentialPreferences.CLOUDFLARE_VERIFIED, false)
                        .apply()
                    badge.text = getString(
                        R.string.bobby_credentials_verification_failed,
                        result.message
                    )
                    badge.setTextColor(getColor(R.color.bobby_settings_error))
                    updateSetupState()
                }
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_RECORD_AUDIO) {
            updateSetupState()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        cancelPendingDictation()
        activityScope.cancel()
    }

    companion object {
        private const val REQUEST_RECORD_AUDIO = 102
        private const val TAG = "BobbySettings"
        private const val TRANSCRIPT_SETTLE_MILLIS = 350L
        private const val REVEAL_STEP_MILLIS = 45L
    }
}

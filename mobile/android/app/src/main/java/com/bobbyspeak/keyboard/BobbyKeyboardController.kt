package com.bobbyspeak.keyboard

import android.content.Context
import android.content.SharedPreferences
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.widget.Button
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.Space
import android.widget.TextView

class BobbyKeyboardController(
    private val context: Context,
    root: View,
    private val actions: Actions
) {
    interface Actions {
        fun onText(text: String)
        fun onBackspace()
        fun onEnter()
        fun onSwitchKeyboard()
        fun onMic(action: ImeVoiceAction)
        fun onSettings()
        fun onOpenApiSetup()
        fun onInsertSavedPrompt(text: String)
    }

    private data class LetterKey(val view: TextView, val letter: Char)

    private val transcriptCard: View = root.findViewById(R.id.bobby_transcript_card)
    private val transcriptBody: TextView = root.findViewById(R.id.bobby_transcript_body)
    private val statusLabel: TextView = root.findViewById(R.id.bobby_status)
    private val progress: ProgressBar = root.findViewById(R.id.bobby_progress)
    private val settingsButton: ImageButton = root.findViewById(R.id.bobby_settings)
    private val micButton: BobbyOrbView = root.findViewById(R.id.bobby_mic)
    private val statusDotsRow: LinearLayout = root.findViewById(R.id.bobby_status_dots)
    private val letterKeys = mutableListOf<LetterKey>()
    private lateinit var shiftButton: ImageButton
    private var shifted = false
    private var voiceState = ImeUiState.resolve()
    private var revealRunnable: Runnable? = null
    private val revealStepMillis = 45L
    private var autoHidePanelRunnable: Runnable? = null
    private val panelAutoHideDelayMillis = 650L
    // Status dot views for recording state color animation.
    private val statusDotViews = mutableListOf<View>()

    // In-keyboard Quick Settings panel bindings.
    private val settingsPanel: View = root.findViewById(R.id.bobby_settings_panel)
    private val tonePillsRow: LinearLayout = root.findViewById(R.id.bobby_tone_pills_row)
    private val actionPillsRow: LinearLayout = root.findViewById(R.id.bobby_action_pills_row)
    private val savedPromptsLabel: View = root.findViewById(R.id.bobby_saved_prompts_label)
    private val savedPromptsScroll: View = root.findViewById(R.id.bobby_saved_prompts_scroll)
    private val savedPromptsRow: LinearLayout = root.findViewById(R.id.bobby_saved_prompts_row)
    private val openApiSetupButton: Button = root.findViewById(R.id.bobby_open_api_setup)
    private val closePanelButton: Button = root.findViewById(R.id.bobby_close_panel)
    private val keyRows: List<View> = listOf(
        root.findViewById(R.id.bobby_row_q),
        root.findViewById(R.id.bobby_row_a),
        root.findViewById(R.id.bobby_row_z),
        root.findViewById(R.id.bobby_row_bottom)
    )

    private val preferences: SharedPreferences =
        context.getSharedPreferences(BobbyCredentialPreferences.FILE_NAME, Context.MODE_PRIVATE)
    private var settingsPanelVisible = false
    private var selectedTone: ImeTone = BobbyCredentialPreferences.getSelectedTone(preferences)
    private var selectedActionId: String = BobbyContentPreferences.selectedActionId(preferences)

    init {
        buildLetterRow(root.findViewById(R.id.bobby_row_q), "qwertyuiop")
        buildLetterRow(
            root.findViewById(R.id.bobby_row_a),
            "asdfghjkl",
            startInsetWeight = 0.45f,
            endInsetWeight = 0.45f
        )
        buildThirdRow(root.findViewById(R.id.bobby_row_z))
        buildBottomRow(root.findViewById(R.id.bobby_row_bottom))

        buildStatusDots()
        buildTonePills()
        buildActionPills()
        buildSavedPromptPills()
        openApiSetupButton.onKeyboardClick { actions.onOpenApiSetup() }
        closePanelButton.onKeyboardClick { toggleSettingsPanel(false) }
        // ⚙ toggles the in-keyboard Quick Settings panel instead of launching
        // the activity directly; the API Setup button inside the panel handles
        // the full BobbySettingsActivity launch.
        settingsButton.onKeyboardClick { toggleSettingsPanel(!settingsPanelVisible) }
        micButton.onKeyboardClick { actions.onMic(voiceState.micAction) }
        renderVoiceState(voiceState)
    }

    /** Builds the compact nine-bar level row directly beneath the right-side Orb. */
    private fun buildStatusDots() {
        statusDotsRow.removeAllViews()
        statusDotViews.clear()
        val dotWidth = dp(BobbyOrbCompactLevelGeometry.barWidthDp)
        val dotHeight = dp(BobbyOrbCompactLevelGeometry.idleHeightDp)
        val dotGap = dp(BobbyOrbCompactLevelGeometry.gapDp)
        for (i in 0 until BobbyOrbCompactLevelGeometry.count) {
            val dot = View(context).apply {
                background = context.getDrawable(R.drawable.bobby_dot_circle)
                backgroundTintList = ColorStateList.valueOf(
                    context.getColor(R.color.bobby_text_secondary)
                )
                layoutParams = LinearLayout.LayoutParams(dotWidth, dotHeight).apply {
                    if (i > 0) leftMargin = dotGap
                }
            }
            statusDotViews.add(dot)
            statusDotsRow.addView(dot)
        }
    }

    /**
     * Shows or hides the in-keyboard Quick Settings overlay. When shown, the
     * QWERTY rows are hidden so the Air OS card can take their place; pill
     * selection state is re-synced from SharedPreferences on every open so a
     * tone/action picked elsewhere (e.g. the setup activity) is reflected.
     */
    fun toggleSettingsPanel(show: Boolean) {
        if (settingsPanelVisible == show) return
        // Cancel any pending auto-hide so a manual open/close or a re-open
        // never races a stale dismissal callback.
        cancelAutoHidePanel()
        settingsPanelVisible = show
        settingsPanel.visibility = if (show) View.VISIBLE else View.GONE
        keyRows.forEach { row -> row.visibility = if (show) View.GONE else View.VISIBLE }
        if (show) {
            selectedTone = BobbyCredentialPreferences.getSelectedTone(preferences)
            selectedActionId = BobbyContentPreferences.selectedActionId(preferences)
            renderTonePills()
            buildActionPills()
            buildSavedPromptPills()
        }
    }

    /**
     * Auto-dismisses the Quick Settings bubble shortly after a pill is tapped so
     * the user immediately returns to the QWERTY keyboard. Only one pending
     * dismissal is ever queued; rapid taps collapse into a single hide. Cancelled
     * by [cancelAutoHidePanel] (called from [toggleSettingsPanel]) so a manual
     * close or re-open never fights a stale callback.
     */
    private fun scheduleAutoHidePanel() {
        cancelAutoHidePanel()
        val runnable = Runnable { toggleSettingsPanel(false) }
        autoHidePanelRunnable = runnable
        settingsPanel.postDelayed(runnable, panelAutoHideDelayMillis)
    }

    private fun cancelAutoHidePanel() {
        autoHidePanelRunnable?.let { settingsPanel.removeCallbacks(it) }
        autoHidePanelRunnable = null
    }

    fun renderVoiceState(state: ImeUiState) {
        cancelReveal()
        voiceState = state
        statusLabel.text = state.message
        statusLabel.setTextColor(context.getColor(statusColor(state.tone)))
        progress.visibility = if (
            state.tone == ImeVoiceTone.NEUTRAL && state.micAction == ImeVoiceAction.NONE
        ) {
            View.VISIBLE
        } else {
            View.GONE
        }

        micButton.isEnabled = state.micEnabled
        micButton.alpha = if (state.micEnabled) 1f else 0.82f
        micButton.setPhase(
            when {
                state.tone == ImeVoiceTone.RECORDING -> ImeVoicePhase.LISTENING
                state.tone == ImeVoiceTone.NEUTRAL -> ImeVoicePhase.PROCESSING
                else -> ImeVoicePhase.IDLE
            }
        )

        // Status dots: orange when recording, grey (muted) when idle.
        val recording = state.tone == ImeVoiceTone.RECORDING
        val dotColor = context.getColor(
            if (recording) R.color.bobby_recording else R.color.bobby_text_secondary
        )
        statusDotViews.forEach { dot ->
            dot.backgroundTintList = ColorStateList.valueOf(dotColor)
        }

        micButton.contentDescription = context.getString(
            when (state.micAction) {
                ImeVoiceAction.START -> R.string.bobby_start_voice
                ImeVoiceAction.STOP -> R.string.bobby_stop_voice
                ImeVoiceAction.OPEN_SETUP -> R.string.bobby_setup_voice
                ImeVoiceAction.NONE -> R.string.bobby_voice_unavailable
            }
        )
    }

    /**
     * Reveals [text] word-by-word into the TRANSCRIPT card body so the user sees
     * the raw recognition stream in like live subtitles while the polish call is
     * still in flight. The card's body label ([bobby_transcript_body]) uses
     * minLines 2 / maxLines 3 with ellipsize=end, so the most recent words always
     * stay visible as the stream grows. Non-blocking: schedules the animation via
     * postDelayed and returns immediately. Any in-flight reveal is cancelled by
     * [cancelReveal] (also called from [renderVoiceState]), so a state change or
     * a new reveal never fights a stale animation. Status copy ("Tap the mic to
     * speak", "Listening…", "Writing…") renders cleanly in the separate status
     * label above the revealed text via [renderVoiceState].
     */
    fun revealTranscript(text: String, onComplete: () -> Unit = {}) {
        cancelReveal()
        // The card hosts the live subtitles; make sure it's on screen before we
        // start streaming into its body label.
        if (transcriptCard.visibility != View.VISIBLE) {
            transcriptCard.visibility = View.VISIBLE
        }
        transcriptBody.visibility = View.VISIBLE
        val words = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty() || !transcriptBody.isAttachedToWindow) {
            transcriptBody.text = text
            onComplete()
            return
        }
        transcriptBody.setTextColor(context.getColor(R.color.bobby_text_primary))
        val builder = StringBuilder()
        var index = 0
        val step = object : Runnable {
            override fun run() {
                if (!transcriptBody.isAttachedToWindow) return
                if (index >= words.size) {
                    transcriptBody.setTextColor(context.getColor(statusColor(voiceState.tone)))
                    revealRunnable = null
                    onComplete()
                    return
                }
                if (builder.isNotEmpty()) builder.append(' ')
                builder.append(words[index])
                transcriptBody.text = builder.toString()
                index++
                transcriptBody.postDelayed(this, revealStepMillis)
            }
        }
        revealRunnable = step
        transcriptBody.postDelayed(step, revealStepMillis)
    }

    private fun cancelReveal() {
        revealRunnable?.let { transcriptBody.removeCallbacks(it) }
        revealRunnable = null
    }

    fun setShifted(value: Boolean) {
        shifted = value
        letterKeys.forEach { key ->
            key.view.text = if (shifted) {
                key.letter.uppercaseChar().toString()
            } else {
                key.letter.toString()
            }
        }
        if (::shiftButton.isInitialized) {
            shiftButton.setColorFilter(
                context.getColor(
                    if (shifted) R.color.bobby_primary else R.color.bobby_text_primary
                )
            )
            shiftButton.contentDescription = if (shifted) {
                "Shift on"
            } else {
                context.getString(R.string.bobby_shift)
            }
        }
    }

    private fun buildTonePills() {
        tonePillsRow.removeAllViews()
        ImeTone.entries.forEach { tone ->
            val pill = makePill(tone.label)
            pill.onKeyboardClick {
                selectedTone = tone
                BobbyCredentialPreferences.setSelectedTone(preferences, tone)
                renderTonePills()
                scheduleAutoHidePanel()
            }
            tonePillsRow.addView(pill)
        }
        renderTonePills()
    }

    private fun buildActionPills() {
        actionPillsRow.removeAllViews()
        BobbyContentPreferences.resolveActions(preferences).forEach { action ->
            val pill = makePill(action.label).apply { tag = action.id }
            pill.onKeyboardClick {
                selectedActionId = action.id
                BobbyContentPreferences.setSelectedActionId(preferences, action.id)
                renderActionPills()
                scheduleAutoHidePanel()
            }
            actionPillsRow.addView(pill)
        }
        renderActionPills()
    }

    private fun renderTonePills() {
        for (index in 0 until tonePillsRow.childCount) {
            val child = tonePillsRow.getChildAt(index) as TextView
            stylePill(child, ImeTone.entries[index] == selectedTone)
        }
    }

    private fun renderActionPills() {
        for (index in 0 until actionPillsRow.childCount) {
            val child = actionPillsRow.getChildAt(index) as TextView
            stylePill(child, child.tag == selectedActionId)
        }
    }

    private fun buildSavedPromptPills() {
        savedPromptsRow.removeAllViews()
        val prompts = BobbyContentPreferences.savedPrompts(preferences)
        val visible = prompts.isNotEmpty()
        savedPromptsLabel.visibility = if (visible) View.VISIBLE else View.GONE
        savedPromptsScroll.visibility = if (visible) View.VISIBLE else View.GONE
        prompts.forEach { prompt ->
            val pill = makePill(prompt.name)
            stylePill(pill, selected = false)
            pill.contentDescription = "Insert saved prompt ${prompt.name}"
            pill.onKeyboardClick {
                actions.onInsertSavedPrompt(prompt.text)
                scheduleAutoHidePanel()
            }
            savedPromptsRow.addView(pill)
        }
    }

    private fun makePill(label: String): TextView {
        val margin = dp(4)
        return TextView(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                dp(BobbyTouchTargetGeometry.minimumDp)
            ).apply {
                setMargins(margin, margin, margin, margin)
            }
            background = context.getDrawable(R.drawable.bobby_pill_default)
            elevation = dp(1).toFloat()
            gravity = Gravity.CENTER
            includeFontPadding = false
            isClickable = true
            isFocusable = true
            minimumWidth = dp(BobbyTouchTargetGeometry.minimumDp)
            setPadding(dp(14), dp(8), dp(14), dp(8))
            text = label
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTypeface(Typeface.create("sans-serif", Typeface.NORMAL))
        }
    }

    private fun stylePill(view: TextView, selected: Boolean) {
        view.background = context.getDrawable(
            if (selected) R.drawable.bobby_pill_selected else R.drawable.bobby_pill_default
        )
        view.setTextColor(
            context.getColor(
                if (selected) R.color.bobby_pill_primary_text else R.color.bobby_text_secondary
            )
        )
    }

    private fun buildLetterRow(
        row: LinearLayout,
        letters: String,
        startInsetWeight: Float = 0f,
        endInsetWeight: Float = 0f
    ) {
        if (startInsetWeight > 0f) addInset(row, startInsetWeight)
        letters.forEach { letter -> addLetterKey(row, letter) }
        if (endInsetWeight > 0f) addInset(row, endInsetWeight)
    }

    private fun buildThirdRow(row: LinearLayout) {
        shiftButton = addIconKey(
            row = row,
            icon = R.drawable.ic_bobby_shift,
            contentDescription = context.getString(R.string.bobby_shift),
            weight = 1.35f
        ) {
            setShifted(!shifted)
        }
        "zxcvbnm".forEach { letter -> addLetterKey(row, letter) }
        addIconKey(
            row = row,
            icon = R.drawable.ic_bobby_backspace,
            contentDescription = context.getString(R.string.bobby_backspace),
            weight = 1.35f
        ) {
            actions.onBackspace()
        }
    }

    private fun buildBottomRow(row: LinearLayout) {
        addTextKey(row, ",", weight = 1f) { actions.onText(",") }
        addIconKey(
            row = row,
            icon = R.drawable.ic_bobby_keyboard,
            contentDescription = context.getString(R.string.bobby_switch_keyboard),
            weight = 1.15f
        ) {
            actions.onSwitchKeyboard()
        }
        addTextKey(
            row = row,
            label = "",
            weight = 4.4f,
            contentDescription = context.getString(R.string.bobby_space),
            utility = false
        ) {
            actions.onText(" ")
        }
        addTextKey(row, ".", weight = 1f) { actions.onText(".") }
        addIconKey(
            row = row,
            icon = R.drawable.ic_bobby_enter,
            contentDescription = context.getString(R.string.bobby_enter),
            weight = 1.35f
        ) {
            actions.onEnter()
        }
    }

    private fun addLetterKey(row: LinearLayout, letter: Char) {
        val key = addTextKey(row, letter.toString(), weight = 1f) {
            actions.onText(
                if (shifted) letter.uppercaseChar().toString() else letter.toString()
            )
            if (shifted) setShifted(false)
        }
        key.contentDescription = letter.toString()
        letterKeys += LetterKey(key, letter)
    }

    private fun addTextKey(
        row: LinearLayout,
        label: String,
        weight: Float,
        contentDescription: String = label,
        utility: Boolean = false,
        onClick: () -> Unit
    ): TextView {
        return TextView(context).apply {
            layoutParams = keyLayoutParams(weight)
            background = context.getDrawable(
                if (utility) {
                    R.drawable.bobby_utility_key_background
                } else {
                    R.drawable.bobby_key_background
                }
            )
            elevation = dp(1).toFloat()
            gravity = Gravity.CENTER
            includeFontPadding = false
            isClickable = true
            isFocusable = true
            text = label
            setTextColor(context.getColor(R.color.bobby_text_primary))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, if (label.length == 1) 21f else 16f)
            setTypeface(Typeface.create("sans-serif", Typeface.NORMAL))
            this.contentDescription = contentDescription
            onKeyboardClick(onClick)
            row.addView(this)
        }
    }

    private fun addIconKey(
        row: LinearLayout,
        icon: Int,
        contentDescription: String,
        weight: Float,
        onClick: () -> Unit
    ): ImageButton {
        return ImageButton(context).apply {
            layoutParams = keyLayoutParams(weight)
            background = context.getDrawable(R.drawable.bobby_utility_key_background)
            elevation = dp(1).toFloat()
            isClickable = true
            isFocusable = true
            setImageResource(icon)
            setColorFilter(context.getColor(R.color.bobby_text_primary))
            setPadding(dp(13), dp(13), dp(13), dp(13))
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            this.contentDescription = contentDescription
            onKeyboardClick(onClick)
            row.addView(this)
        }
    }

    private fun addInset(row: LinearLayout, weight: Float) {
        row.addView(
            Space(context),
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, weight)
        )
    }

    private fun keyLayoutParams(weight: Float): LinearLayout.LayoutParams {
        val margin = dp(2)
        return LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, weight).apply {
            setMargins(margin, margin, margin, margin)
        }
    }

    private fun statusColor(tone: ImeVoiceTone): Int {
        return when (tone) {
            ImeVoiceTone.RECORDING -> R.color.bobby_recording
            ImeVoiceTone.SUCCESS -> R.color.bobby_success
            ImeVoiceTone.WARNING -> R.color.bobby_warning
            ImeVoiceTone.ERROR -> R.color.bobby_error
            ImeVoiceTone.MUTED -> R.color.bobby_disabled
            ImeVoiceTone.NEUTRAL,
            ImeVoiceTone.PRIMARY -> R.color.bobby_text_secondary
        }
    }

    private fun View.onKeyboardClick(action: () -> Unit) {
        setOnClickListener { view ->
            view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            action()
        }
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            context.resources.displayMetrics
        ).toInt()
    }
}

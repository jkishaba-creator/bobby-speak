package com.bobbyspeak.keyboard

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.view.inputmethod.InputMethodManager
import kotlinx.coroutines.*

/**
 * Bobby Speak setup, keyboard test, and Cloudflare credential verification.
 */
class BobbySettingsActivity : Activity() {

    private val activityScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val cloudflareClient = CloudflareClient()

    private lateinit var setupStatus: TextView
    private lateinit var enableKeyboardButton: Button
    private lateinit var selectKeyboardButton: Button
    private lateinit var microphoneButton: Button
    private lateinit var testInput: EditText

    private val ownImeId: String by lazy {
        ComponentName(this, BobbyInputMethodService::class.java).flattenToShortString()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("bobby_speak_prefs", Context.MODE_PRIVATE)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
            setBackgroundColor(Color.parseColor("#0F172A")) // Modern Dark Background
        }

        val scrollView = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#0F172A"))
            isFillViewport = true
            addView(layout)
        }

        val title = TextView(this).apply {
            text = "Bobby Speak — Android Setup"
            textSize = 20f
            setTextColor(Color.WHITE)
            setPadding(0, 0, 0, 12)
        }

        setupStatus = TextView(this).apply {
            textSize = 15f
            setTextColor(Color.parseColor("#F59E0B"))
            setPadding(0, 0, 0, 16)
        }

        testInput = EditText(this).apply {
            hint = "Try Bobby Speak here"
            contentDescription = "Bobby test input"
            minLines = 2
            inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or
                InputType.TYPE_TEXT_FLAG_MULTI_LINE
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#94A3B8"))
            setOnClickListener { postDelayed({ updateSetupState() }, 500) }
        }

        val testKeyboardButton = Button(this).apply {
            text = "Show Bobby Keyboard"
            contentDescription = "Bobby show keyboard"
            setBackgroundColor(Color.parseColor("#475569"))
            setTextColor(Color.WHITE)
            setOnClickListener { focusTestInput() }
        }

        enableKeyboardButton = Button(this).apply {
            text = "1. Enable Bobby Speak"
            contentDescription = "Bobby enable input method"
            setBackgroundColor(Color.parseColor("#3B82F6"))
            setTextColor(Color.WHITE)
            setOnClickListener { openInputMethodSettings() }
        }

        selectKeyboardButton = Button(this).apply {
            text = "2. Choose Bobby Speak"
            contentDescription = "Bobby choose input method"
            setBackgroundColor(Color.parseColor("#3B82F6"))
            setTextColor(Color.WHITE)
            setOnClickListener {
                inputMethodManager().showInputMethodPicker()
                setupStatus.postDelayed({ updateSetupState() }, 750)
            }
        }

        microphoneButton = Button(this).apply {
            text = "3. Allow Microphone"
            setBackgroundColor(Color.parseColor("#3B82F6"))
            setTextColor(Color.WHITE)
            setOnClickListener { requestMicrophonePermission() }
        }

        val cloudflareTitle = TextView(this).apply {
            text = "4. Connect Cloudflare Workers AI"
            textSize = 18f
            setTextColor(Color.WHITE)
            setPadding(0, 24, 0, 16)
        }

        val accountIdLabel = TextView(this).apply {
            text = "Cloudflare Account ID:"
            setTextColor(Color.parseColor("#94A3B8"))
        }
        val accountIdInput = EditText(this).apply {
            setText(prefs.getString("cf_account_id", ""))
            hint = "e.g. 1a2b3c4d5e..."
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#64748B"))
        }

        val apiTokenLabel = TextView(this).apply {
            text = "Cloudflare API Token:"
            setTextColor(Color.parseColor("#94A3B8"))
        }
        val apiTokenInput = EditText(this).apply {
            setText(prefs.getString("cf_api_token", ""))
            hint = "Raw API token (without Bearer)"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#64748B"))
        }

        val statusBadge = TextView(this).apply {
            val hasSavedCredentials = !prefs.getString("cf_account_id", "").isNullOrBlank() &&
                !prefs.getString("cf_api_token", "").isNullOrBlank()
            val credentialsVerified = hasSavedCredentials && prefs.getBoolean("cf_verified", false)
            text = when {
                credentialsVerified -> "🟢 Workers AI credentials verified"
                hasSavedCredentials -> "⚪ Credentials saved — verification not run"
                else -> "⚪ Cloudflare credentials not configured"
            }
            textSize = 14f
            setTextColor(Color.parseColor(if (credentialsVerified) "#22C55E" else "#CBD5E1"))
            setPadding(0, 16, 0, 16)
        }

        val testConnectionButton = Button(this).apply {
            text = "⚡ Test & Verify Connection"
            setBackgroundColor(Color.parseColor("#3B82F6")) // Blue Accent
            setTextColor(Color.WHITE)
            setOnClickListener {
                val credentials = CloudflareCredentials.fromRaw(
                    accountIdInput.text.toString(),
                    apiTokenInput.text.toString()
                )
                verifyCloudflareCredentials(credentials, statusBadge)
            }
        }

        val saveButton = Button(this).apply {
            text = "Save Credentials"
            setBackgroundColor(Color.parseColor("#10B981")) // Emerald Green Accent
            setTextColor(Color.WHITE)
            setOnClickListener {
                val credentials = CloudflareCredentials.fromRaw(
                    accountIdInput.text.toString(),
                    apiTokenInput.text.toString()
                )

                if (!credentials.isComplete) {
                    statusBadge.text = "🔴 Missing Account ID or API token"
                    statusBadge.setTextColor(Color.parseColor("#EF4444"))
                    return@setOnClickListener
                }

                prefs.edit()
                    .putString("cf_account_id", credentials.accountId)
                    .putString("cf_api_token", credentials.apiToken)
                    .putBoolean("cf_verified", false)
                    .apply()

                accountIdInput.setText(credentials.accountId)
                apiTokenInput.setText(credentials.apiToken)
                statusBadge.text = "⚪ Credentials saved — tap Verify Workers AI"
                statusBadge.setTextColor(Color.parseColor("#CBD5E1"))
                Toast.makeText(this@BobbySettingsActivity, "Cloudflare credentials saved", Toast.LENGTH_SHORT).show()
            }
        }

        layout.addView(title)
        layout.addView(setupStatus)
        layout.addView(testInput)
        layout.addView(testKeyboardButton)
        layout.addView(enableKeyboardButton)
        layout.addView(selectKeyboardButton)
        layout.addView(microphoneButton)
        layout.addView(cloudflareTitle)
        layout.addView(accountIdLabel)
        layout.addView(accountIdInput)
        layout.addView(apiTokenLabel)
        layout.addView(apiTokenInput)
        layout.addView(statusBadge)
        layout.addView(testConnectionButton)
        layout.addView(saveButton)

        setContentView(scrollView)
        updateSetupState()
    }

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

    private fun inputMethodManager(): InputMethodManager {
        return getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    }

    private fun isOwnImeEnabled(): Boolean {
        return inputMethodManager().enabledInputMethodList.any { it.id == ownImeId }
    }

    @Suppress("DEPRECATION")
    private fun isOwnImeSelected(): Boolean {
        val currentImeId = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            inputMethodManager().currentInputMethodInfo?.id
        } else {
            null
        }
        if (currentImeId == ownImeId) return true

        // Some Android 14+ builds keep currentInputMethodInfo stale while the
        // picker closes over an already-resumed Activity. DEFAULT_INPUT_METHOD
        // remains the documented InputMethodInfo ID and refreshes immediately.
        val selectedSetting = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.DEFAULT_INPUT_METHOD
        )
        return selectedSetting == ownImeId
    }

    private fun updateSetupState() {
        val enabled = isOwnImeEnabled()
        val selected = isOwnImeSelected()
        val microphoneGranted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        val prefs = getSharedPreferences("bobby_speak_prefs", Context.MODE_PRIVATE)
        val cloudflareConfigured = !prefs.getString("cf_account_id", "").isNullOrBlank() &&
            !prefs.getString("cf_api_token", "").isNullOrBlank()
        val setupState = BobbySetupState(
            imeEnabled = enabled,
            imeSelected = selected,
            microphoneGranted = microphoneGranted,
            cloudflareConfigured = cloudflareConfigured,
            cloudflareVerified = cloudflareConfigured && prefs.getBoolean("cf_verified", false)
        )

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
            Color.parseColor(if (setupState.isReady) "#22C55E" else "#F59E0B")
        )
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
            badge.text = "🔴 Missing Account ID or API token"
            badge.setTextColor(Color.parseColor("#EF4444"))
            return
        }

        badge.text = "⏳ Verifying this account can run Workers AI..."
        badge.setTextColor(Color.parseColor("#F59E0B")) // Amber / Testing

        activityScope.launch {
            val result = withContext(Dispatchers.IO) {
                cloudflareClient.verify(credentials)
            }

            when (result) {
                is CloudflareResult.Success -> {
                    getSharedPreferences("bobby_speak_prefs", Context.MODE_PRIVATE)
                        .edit()
                        .putString("cf_account_id", credentials.accountId)
                        .putString("cf_api_token", credentials.apiToken)
                        .putBoolean("cf_verified", true)
                        .apply()
                    badge.text = "🟢 Workers AI credentials verified"
                    badge.setTextColor(Color.parseColor("#22C55E"))
                    updateSetupState()
                }
                is CloudflareResult.Failure -> {
                    getSharedPreferences("bobby_speak_prefs", Context.MODE_PRIVATE)
                        .edit()
                        .putBoolean("cf_verified", false)
                        .apply()
                    badge.text = "🔴 Verification failed: ${result.message}"
                    badge.setTextColor(Color.parseColor("#EF4444"))
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
        activityScope.cancel()
    }

    companion object {
        private const val REQUEST_RECORD_AUDIO = 102
    }
}

package com.bobbyspeak.keyboard

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * Bobby Speak Settings Activity.
 *
 * Allows users to configure their Cloudflare Account ID and API Token
 * for mobile speech-to-text dictation and smart formatting.
 */
class BobbySettingsActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("bobby_speak_prefs", Context.MODE_PRIVATE)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }

        val title = TextView(this).apply {
            text = "Bobby Speak — Cloudflare Settings"
            textSize = 20f
            setPadding(0, 0, 0, 24)
        }

        val accountIdLabel = TextView(this).apply {
            text = "Cloudflare Account ID:"
        }
        val accountIdInput = EditText(this).apply {
            setText(prefs.getString("cf_account_id", ""))
            hint = "e.g. 1a2b3c4d5e..."
        }

        val apiTokenLabel = TextView(this).apply {
            text = "Cloudflare API Token:"
        }
        val apiTokenInput = EditText(this).apply {
            setText(prefs.getString("cf_api_token", ""))
            hint = "e.g. Bearer Token..."
        }

        val saveButton = Button(this).apply {
            text = "Save Credentials"
            setOnClickListener {
                val accId = accountIdInput.text.toString().trim()
                val token = apiTokenInput.text.toString().trim()

                prefs.edit()
                    .putString("cf_account_id", accId)
                    .putString("cf_api_token", token)
                    .apply()

                Toast.makeText(this@BobbySettingsActivity, "Cloudflare settings saved!", Toast.LENGTH_SHORT).show()
                finish()
            }
        }

        layout.addView(title)
        layout.addView(accountIdLabel)
        layout.addView(accountIdInput)
        layout.addView(apiTokenLabel)
        layout.addView(apiTokenInput)
        layout.addView(saveButton)

        setContentView(layout)
    }
}

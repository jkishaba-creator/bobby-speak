package com.bobbyspeak.keyboard

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * Permission Activity.
 *
 * Requests RECORD_AUDIO permission on behalf of the InputMethodService
 * (since Android IMEs cannot launch runtime permission dialogs directly).
 */
class PermissionActivity : Activity() {

    companion object {
        private const val REQUEST_RECORD_AUDIO = 101
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }

        val descriptionText = TextView(this).apply {
            text = getString(R.string.bobby_microphone_permission_description)
            textSize = 16f
            setPadding(0, 0, 0, 24)
        }

        val grantButton = Button(this).apply {
            text = getString(R.string.bobby_grant_microphone_permission)
            setOnClickListener {
                requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_RECORD_AUDIO)
            }
        }

        layout.addView(descriptionText)
        layout.addView(grantButton)
        setContentView(layout)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_RECORD_AUDIO) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(
                    this,
                    getString(R.string.bobby_microphone_permission_granted),
                    Toast.LENGTH_SHORT
                ).show()
            } else {
                Toast.makeText(
                    this,
                    getString(R.string.bobby_microphone_permission_denied),
                    Toast.LENGTH_SHORT
                ).show()
            }
            finish()
        }
    }
}

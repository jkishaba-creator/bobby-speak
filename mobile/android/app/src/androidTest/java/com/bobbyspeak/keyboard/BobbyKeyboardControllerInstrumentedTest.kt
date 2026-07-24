package com.bobbyspeak.keyboard

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BobbyKeyboardControllerInstrumentedTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context: Context = instrumentation.targetContext
    private val preferences by lazy {
        context.getSharedPreferences(
            BobbyCredentialPreferences.FILE_NAME,
            Context.MODE_PRIVATE
        )
    }

    @Before
    fun clearPreferences() {
        preferences.edit().clear().commit()
    }

    @After
    fun cleanUpPreferences() {
        preferences.edit().clear().commit()
    }

    @Test
    fun savedPromptPillInsertsTextThroughKeyboardActions() {
        BobbyContentPreferences.setSavedPrompts(
            preferences,
            listOf(
                BobbySavedPrompt(
                    id = "greeting",
                    name = "Greeting",
                    text = "Hello from Bobby"
                )
            )
        )
        var insertedText: String? = null

        instrumentation.runOnMainSync {
            val root = LayoutInflater.from(context).inflate(R.layout.ime_bobby, null)
            val controller = BobbyKeyboardController(
                context = context,
                root = root,
                actions = testActions { insertedText = it }
            )

            controller.toggleSettingsPanel(true)
            val prompt = requireNotNull(findText(root, "Greeting"))
            prompt.performClick()
        }

        assertEquals("Hello from Bobby", insertedText)
    }

    @Test
    fun typeAndTonePillsPersistSelectionAndMeetTouchTarget() {
        BobbyContentPreferences.setCustomActions(
            preferences,
            listOf(
                BobbyCustomAction(
                    id = "single-character",
                    label = "X",
                    prompt = "Rewrite the text"
                )
            )
        )

        instrumentation.runOnMainSync {
            val root = LayoutInflater.from(context).inflate(R.layout.ime_bobby, null)
            val controller = BobbyKeyboardController(
                context = context,
                root = root,
                actions = testActions()
            )

            controller.toggleSettingsPanel(true)
            val summarize = requireNotNull(findText(root, "Summarize"))
            val confident = requireNotNull(findText(root, "Confident"))
            val singleCharacter = requireNotNull(findText(root, "X"))
            assertTrue(summarize.layoutParams.height >= dp(44))
            assertTrue(confident.layoutParams.height >= dp(44))
            assertTrue(summarize.minimumWidth >= dp(44))
            assertTrue(confident.minimumWidth >= dp(44))
            assertTrue(singleCharacter.minimumWidth >= dp(44))
            assertTrue(singleCharacter.layoutParams.height >= dp(44))
            summarize.performClick()
            confident.performClick()
        }

        assertEquals(
            "summarize",
            BobbyContentPreferences.selectedActionId(preferences)
        )
        assertEquals(
            ImeTone.CONFIDENT,
            BobbyCredentialPreferences.getSelectedTone(preferences)
        )
    }

    private fun testActions(
        onInsertSavedPrompt: (String) -> Unit = {}
    ): BobbyKeyboardController.Actions =
        object : BobbyKeyboardController.Actions {
            override fun onText(text: String) = Unit
            override fun onBackspace() = Unit
            override fun onEnter() = Unit
            override fun onSwitchKeyboard() = Unit
            override fun onMic(action: ImeVoiceAction) = Unit
            override fun onSettings() = Unit
            override fun onOpenApiSetup() = Unit
            override fun onInsertSavedPrompt(text: String) = onInsertSavedPrompt(text)
        }

    private fun findText(view: View, text: String): TextView? {
        if (view is TextView && view.text.toString() == text) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                findText(view.getChildAt(index), text)?.let { return it }
            }
        }
        return null
    }

    private fun dp(value: Int): Int =
        (value * context.resources.displayMetrics.density).toInt()
}

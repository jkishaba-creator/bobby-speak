package com.bobbyspeak.keyboard

import org.junit.Assert.assertEquals
import org.junit.Test

class BobbySelectedActionTest {

    @Test
    fun `selected summarize is resolved for the next keyboard dictation`() {
        assertEquals(
            "summarize",
            selectActionForDictation(
                selectedId = "summarize",
                actions = BobbyActionCatalog.builtIns
            ).id
        )
    }

    @Test
    fun `selected custom action is resolved for the next keyboard dictation`() {
        val actions = BobbyActionCatalog.builtIns + BobbyActionCatalog.fromCustom(
            BobbyCustomAction("slack", "Slack", "Write a Slack message")
        )

        assertEquals(
            "custom-slack",
            selectActionForDictation(
                selectedId = "custom-slack",
                actions = actions
            ).id
        )
    }

    @Test
    fun `missing custom selection safely falls back to clean`() {
        assertEquals(
            "clean",
            selectActionForDictation(
                selectedId = "custom-missing",
                actions = BobbyActionCatalog.builtIns
            ).id
        )
    }

    @Test
    fun `dictation selection carries the selected type and tone into processing`() {
        val selection = resolveDictationSelection(
            selectedId = "summarize",
            actions = BobbyActionCatalog.builtIns,
            tone = ImeTone.CONFIDENT
        )

        assertEquals("summarize", selection.action.id)
        assertEquals(ImeTone.CONFIDENT, selection.tone)
    }
}

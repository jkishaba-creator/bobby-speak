package com.bobbyspeak.keyboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BobbyContentPreferencesTest {

    @Test
    fun `custom actions round trip through JSON`() {
        val actions = listOf(
            BobbyCustomAction("slack", "Slack", "Write a Slack message"),
            BobbyCustomAction("email", "Email", "Write a concise email")
        )

        assertEquals(
            actions,
            BobbyContentPreferences.decodeCustomActions(
                BobbyContentPreferences.encodeCustomActions(actions)
            )
        )
    }

    @Test
    fun `saved prompts round trip through JSON`() {
        val prompts = listOf(
            BobbySavedPrompt("daily", "Daily", "Summarize today's progress"),
            BobbySavedPrompt("review", "Review", "Review these changes")
        )

        assertEquals(
            prompts,
            BobbyContentPreferences.decodeSavedPrompts(
                BobbyContentPreferences.encodeSavedPrompts(prompts)
            )
        )
    }

    @Test
    fun `string collections round trip while preserving order`() {
        val values = listOf("custom-slack", "clean", "ask")

        assertEquals(
            values,
            BobbyContentPreferences.decodeStringList(
                BobbyContentPreferences.encodeStringList(values)
            )
        )
    }

    @Test
    fun `malformed rows do not discard valid content`() {
        val json =
            """[
                {"id":"good","label":"Good","prompt":"Keep this"},
                {"id":"","label":"Bad","prompt":"Skip this"},
                "not-an-object",
                {"id":"also-good","label":"Also good","prompt":"Keep this too"}
            ]""".trimIndent()

        assertEquals(
            listOf("good", "also-good"),
            BobbyContentPreferences.decodeCustomActions(json).map { it.id }
        )
    }

    @Test
    fun `invalid JSON safely returns empty collections`() {
        assertTrue(BobbyContentPreferences.decodeCustomActions("{").isEmpty())
        assertTrue(BobbyContentPreferences.decodeSavedPrompts("not-json").isEmpty())
        assertTrue(BobbyContentPreferences.decodeStringList("").isEmpty())
    }

    @Test
    fun `legacy built in selection migrates to stable lowercase id`() {
        assertEquals(
            "summarize",
            BobbyContentPreferences.normalizeSelectedActionId(
                "Summarize",
                BobbyActionCatalog.builtIns
            )
        )
    }

    @Test
    fun `missing selected custom action falls back to clean`() {
        assertEquals(
            "clean",
            BobbyContentPreferences.normalizeSelectedActionId(
                "custom-missing",
                BobbyActionCatalog.builtIns
            )
        )
    }

    @Test
    fun `available selected custom action remains selected`() {
        val actions = BobbyActionCatalog.builtIns + BobbyActionCatalog.fromCustom(
            BobbyCustomAction("slack", "Slack", "Write a Slack message")
        )

        assertEquals(
            "custom-slack",
            BobbyContentPreferences.normalizeSelectedActionId(
                "custom-slack",
                actions
            )
        )
    }
}

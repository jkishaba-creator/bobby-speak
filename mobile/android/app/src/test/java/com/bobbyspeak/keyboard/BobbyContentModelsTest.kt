package com.bobbyspeak.keyboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BobbyContentModelsTest {

    @Test
    fun `resolve keeps explicit order and removes hidden actions`() {
        val custom = BobbyCustomAction(
            id = "slack",
            label = "Slack",
            prompt = "Turn this into a Slack message"
        )

        val resolved = BobbyActionCatalog.resolve(
            customActions = listOf(custom),
            hiddenIds = setOf("summarize"),
            orderedIds = listOf("custom-slack", "clean")
        )

        assertEquals(
            listOf("custom-slack", "clean", "sharpen", "ask"),
            resolved.map { it.id }
        )
    }

    @Test
    fun `resolve ignores unknown and duplicate order ids`() {
        val resolved = BobbyActionCatalog.resolve(
            customActions = emptyList(),
            hiddenIds = emptySet(),
            orderedIds = listOf("missing", "ask", "ask", "clean")
        )

        assertEquals(
            listOf("ask", "clean", "summarize", "sharpen"),
            resolved.map { it.id }
        )
    }

    @Test
    fun `tone applies only to clean sharpen and custom actions`() {
        assertTrue(
            BobbyActionCatalog.systemPrompt(
                BobbyActionCatalog.clean,
                ImeTone.DIRECT
            ).contains("direct tone")
        )
        assertFalse(
            BobbyActionCatalog.systemPrompt(
                BobbyActionCatalog.summarize,
                ImeTone.DIRECT
            ).contains("direct tone")
        )
        assertFalse(
            BobbyActionCatalog.systemPrompt(
                BobbyActionCatalog.ask,
                ImeTone.DIRECT
            ).contains("direct tone")
        )
        assertTrue(
            BobbyActionCatalog.systemPrompt(
                BobbyActionCatalog.fromCustom(
                    BobbyCustomAction("mail", "Email", "Write an email")
                ),
                ImeTone.DIRECT
            ).contains("direct tone")
        )
    }

    @Test
    fun `custom action validation enforces current web limits`() {
        assertFalse(
            BobbyActionCatalog.validateCustom(
                id = null,
                label = "",
                prompt = "Do this",
                existing = emptyList()
            ).isValid
        )
        assertFalse(
            BobbyActionCatalog.validateCustom(
                id = null,
                label = "12345678901234567",
                prompt = "Do this",
                existing = emptyList()
            ).isValid
        )
        assertFalse(
            BobbyActionCatalog.validateCustom(
                id = null,
                label = "Chip",
                prompt = "x".repeat(501),
                existing = emptyList()
            ).isValid
        )
        assertFalse(
            BobbyActionCatalog.validateCustom(
                id = null,
                label = "Chip",
                prompt = "Do this",
                existing = (1..12).map {
                    BobbyCustomAction("$it", "Chip $it", "Do $it")
                }
            ).isValid
        )
    }

    @Test
    fun `editing an existing custom action does not consume another slot`() {
        val existing = (1..12).map {
            BobbyCustomAction("$it", "Chip $it", "Do $it")
        }

        val result = BobbyActionCatalog.validateCustom(
            id = "4",
            label = "Updated",
            prompt = "Do something better",
            existing = existing
        )

        assertTrue(result.isValid)
        assertEquals("4", result.value?.id)
    }

    @Test
    fun `saved prompt validation enforces current web limits`() {
        assertFalse(
            BobbyPromptCatalog.validate(
                id = null,
                name = "",
                text = "text",
                existing = emptyList()
            ).isValid
        )
        assertFalse(
            BobbyPromptCatalog.validate(
                id = null,
                name = "name",
                text = "",
                existing = emptyList()
            ).isValid
        )
        assertFalse(
            BobbyPromptCatalog.validate(
                id = null,
                name = "x".repeat(25),
                text = "text",
                existing = emptyList()
            ).isValid
        )
        assertFalse(
            BobbyPromptCatalog.validate(
                id = null,
                name = "name",
                text = "x".repeat(2001),
                existing = emptyList()
            ).isValid
        )
    }

    @Test
    fun `saved prompt name suggestion stops on a whole word`() {
        assertEquals(
            "Summarize this daily",
            BobbyPromptCatalog.suggestName(
                "Summarize this daily project update for the team"
            )
        )
    }
}

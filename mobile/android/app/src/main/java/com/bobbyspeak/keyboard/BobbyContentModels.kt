package com.bobbyspeak.keyboard

import java.util.UUID

data class BobbyCustomAction(
    val id: String,
    val label: String,
    val prompt: String
)

data class BobbySavedPrompt(
    val id: String,
    val name: String,
    val text: String
)

data class BobbyTextAction(
    val id: String,
    val label: String,
    val hint: String,
    val system: String,
    val toneable: Boolean,
    val custom: Boolean = false
)

data class BobbyContentValidation<T>(
    val value: T? = null,
    val error: String? = null
) {
    val isValid: Boolean
        get() = value != null && error == null
}

object BobbyActionCatalog {
    const val CUSTOM_PREFIX = "custom-"
    const val MAX_CUSTOM_ACTIONS = 12
    const val MAX_LABEL_LENGTH = 16
    const val MAX_PROMPT_LENGTH = 500

    val clean = BobbyTextAction(
        id = "clean",
        label = "Clean",
        hint = "Fix grammar and cut filler",
        toneable = true,
        system =
            "Rewrite the user's dictated text so it reads like clean writing: fix " +
                "grammar, punctuation, and capitalization, and remove filler words, " +
                "stutters, and false starts. Keep the meaning, the tone, and roughly " +
                "the same length. Reply with ONLY the rewritten text."
    )

    val summarize = BobbyTextAction(
        id = "summarize",
        label = "Summarize",
        hint = "Condense to the key points",
        toneable = false,
        system =
            "Summarize the user's text down to its key points. Be concise. If " +
                "there are several distinct points, use short lines each starting with " +
                "\"- \". Do not add information that is not in the text. Reply with " +
                "ONLY the summary."
    )

    val sharpen = BobbyTextAction(
        id = "sharpen",
        label = "Sharpen",
        hint = "Make it direct and punchy",
        toneable = true,
        system =
            "Rewrite the user's text to be sharper and more direct: cut hedging, " +
                "redundancy, and throat-clearing; prefer active voice; keep it natural " +
                "and professional rather than terse. Preserve every substantive point. " +
                "Reply with ONLY the rewritten text."
    )

    val ask = BobbyTextAction(
        id = "ask",
        label = "Ask",
        hint = "Answer the dictated prompt",
        toneable = false,
        system =
            "Answer or complete the user's dictated prompt. Be concise and specific. " +
                "Reply with ONLY the answer or completed text."
    )

    val builtIns: List<BobbyTextAction> = listOf(clean, summarize, sharpen, ask)

    fun fromCustom(value: BobbyCustomAction): BobbyTextAction {
        val oneLine = value.prompt.trim().replace(Regex("\\s+"), " ")
        val hint = if (oneLine.length > 60) {
            oneLine.take(59).trimEnd() + "…"
        } else {
            oneLine
        }
        return BobbyTextAction(
            id = CUSTOM_PREFIX + value.id,
            label = value.label,
            hint = hint,
            system =
                value.prompt.trim() +
                    "\n\nReply with ONLY the resulting text — no preamble, no quotes.",
            toneable = true,
            custom = true
        )
    }

    fun resolve(
        customActions: List<BobbyCustomAction>,
        hiddenIds: Set<String>,
        orderedIds: List<String>
    ): List<BobbyTextAction> {
        val catalog = builtIns + customActions.map(::fromCustom)
        val byId = catalog.associateBy { it.id }
        val ordered = mutableListOf<BobbyTextAction>()
        val seen = mutableSetOf<String>()

        orderedIds.forEach { id ->
            val action = byId[id]
            if (action != null && seen.add(id)) ordered += action
        }
        catalog.forEach { action ->
            if (seen.add(action.id)) ordered += action
        }

        return ordered.filterNot { it.id in hiddenIds }
    }

    fun systemPrompt(action: BobbyTextAction, tone: ImeTone): String {
        if (!action.toneable || tone == ImeTone.NONE) return action.system
        return action.system + "\n\nWrite the result in a ${tone.id.lowercase()} tone."
    }

    fun validateCustom(
        id: String?,
        label: String,
        prompt: String,
        existing: List<BobbyCustomAction>
    ): BobbyContentValidation<BobbyCustomAction> {
        val cleanLabel = label.trim()
        val cleanPrompt = prompt.trim()
        if (cleanLabel.isEmpty()) {
            return BobbyContentValidation(error = "Give the chip a label.")
        }
        if (cleanLabel.length > MAX_LABEL_LENGTH) {
            return BobbyContentValidation(
                error = "Label must be $MAX_LABEL_LENGTH characters or fewer."
            )
        }
        if (cleanPrompt.isEmpty()) {
            return BobbyContentValidation(error = "Add an instruction.")
        }
        if (cleanPrompt.length > MAX_PROMPT_LENGTH) {
            return BobbyContentValidation(
                error = "Instruction must be $MAX_PROMPT_LENGTH characters or fewer."
            )
        }

        val isEdit = id != null && existing.any { it.id == id }
        if (!isEdit && existing.size >= MAX_CUSTOM_ACTIONS) {
            return BobbyContentValidation(
                error = "You can have up to $MAX_CUSTOM_ACTIONS custom chips."
            )
        }

        return BobbyContentValidation(
            value = BobbyCustomAction(
                id = id?.takeIf { isEdit } ?: UUID.randomUUID().toString(),
                label = cleanLabel,
                prompt = cleanPrompt
            )
        )
    }
}

object BobbyPromptCatalog {
    const val MAX_SAVED_PROMPTS = 20
    const val MAX_NAME_LENGTH = 24
    const val MAX_TEXT_LENGTH = 2_000

    fun validate(
        id: String?,
        name: String,
        text: String,
        existing: List<BobbySavedPrompt>
    ): BobbyContentValidation<BobbySavedPrompt> {
        val cleanName = name.trim()
        val cleanText = text.trim()
        if (cleanName.isEmpty()) {
            return BobbyContentValidation(error = "Give the prompt a name.")
        }
        if (cleanName.length > MAX_NAME_LENGTH) {
            return BobbyContentValidation(
                error = "Name must be $MAX_NAME_LENGTH characters or fewer."
            )
        }
        if (cleanText.isEmpty()) {
            return BobbyContentValidation(error = "Nothing to save yet.")
        }
        if (cleanText.length > MAX_TEXT_LENGTH) {
            return BobbyContentValidation(
                error = "Prompt must be $MAX_TEXT_LENGTH characters or fewer."
            )
        }

        val isEdit = id != null && existing.any { it.id == id }
        if (!isEdit && existing.size >= MAX_SAVED_PROMPTS) {
            return BobbyContentValidation(
                error = "You can save up to $MAX_SAVED_PROMPTS prompts."
            )
        }

        return BobbyContentValidation(
            value = BobbySavedPrompt(
                id = id?.takeIf { isEdit } ?: UUID.randomUUID().toString(),
                name = cleanName,
                text = cleanText
            )
        )
    }

    fun suggestName(text: String): String {
        val collapsed = text.trim().replace(Regex("\\s+"), " ")
        if (collapsed.length <= MAX_NAME_LENGTH) return collapsed

        val cut = collapsed.take(MAX_NAME_LENGTH)
        val lastSpace = cut.lastIndexOf(' ')
        return if (lastSpace > 0) cut.take(lastSpace).trim() else cut.trim()
    }
}

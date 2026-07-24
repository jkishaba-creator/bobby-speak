package com.bobbyspeak.keyboard

internal data class BobbyDictationOutcome(
    val text: String,
    val errorMessage: String?
)

internal data class BobbyDictationSelection(
    val action: BobbyTextAction,
    val tone: ImeTone
)

internal object BobbyDictationTransform {
    fun execute(
        raw: String,
        selection: BobbyDictationSelection,
        actionRunner: (
            text: String,
            action: BobbyTextAction,
            tone: ImeTone
        ) -> CloudflareResult<String>
    ): BobbyDictationOutcome =
        outcome(
            raw = raw,
            result = actionRunner(raw, selection.action, selection.tone)
        )

    fun outcome(raw: String, result: CloudflareResult<String>): BobbyDictationOutcome =
        when (result) {
            is CloudflareResult.Success -> BobbyDictationOutcome(
                text = result.value.takeIf { it.isNotBlank() } ?: raw,
                errorMessage = null
            )
            is CloudflareResult.Failure -> BobbyDictationOutcome(
                text = raw,
                errorMessage = result.message
            )
        }

    fun finalText(raw: String, result: CloudflareResult<String>): String =
        outcome(raw, result).text
}

internal fun selectActionForDictation(
    selectedId: String?,
    actions: List<BobbyTextAction>
): BobbyTextAction =
    actions.firstOrNull { it.id == selectedId } ?: BobbyActionCatalog.clean

internal fun resolveDictationSelection(
    selectedId: String?,
    actions: List<BobbyTextAction>,
    tone: ImeTone
): BobbyDictationSelection =
    BobbyDictationSelection(
        action = selectActionForDictation(selectedId, actions),
        tone = tone
    )

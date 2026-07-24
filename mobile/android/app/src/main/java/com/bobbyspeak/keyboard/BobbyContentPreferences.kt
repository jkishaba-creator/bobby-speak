package com.bobbyspeak.keyboard

import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

internal object BobbyContentPreferences {
    const val SELECTED_ACTION_ID = "selected_action_id"
    const val CUSTOM_ACTIONS = "custom_actions_json"
    const val HIDDEN_ACTIONS = "hidden_actions_json"
    const val ACTION_ORDER = "action_order_json"
    const val SAVED_PROMPTS = "saved_prompts_json"

    fun encodeCustomActions(values: List<BobbyCustomAction>): String {
        val array = JSONArray()
        values.forEach { value ->
            array.put(
                JSONObject()
                    .put("id", value.id)
                    .put("label", value.label)
                    .put("prompt", value.prompt)
            )
        }
        return array.toString()
    }

    fun decodeCustomActions(raw: String?): List<BobbyCustomAction> {
        val array = parseArray(raw) ?: return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val id = item.optString("id").trim()
                val label = item.optString("label").trim()
                val prompt = item.optString("prompt").trim()
                if (id.isNotEmpty() && label.isNotEmpty() && prompt.isNotEmpty()) {
                    add(BobbyCustomAction(id, label, prompt))
                }
            }
        }
    }

    fun encodeSavedPrompts(values: List<BobbySavedPrompt>): String {
        val array = JSONArray()
        values.forEach { value ->
            array.put(
                JSONObject()
                    .put("id", value.id)
                    .put("name", value.name)
                    .put("text", value.text)
            )
        }
        return array.toString()
    }

    fun decodeSavedPrompts(raw: String?): List<BobbySavedPrompt> {
        val array = parseArray(raw) ?: return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val id = item.optString("id").trim()
                val name = item.optString("name").trim()
                val text = item.optString("text").trim()
                if (id.isNotEmpty() && name.isNotEmpty() && text.isNotEmpty()) {
                    add(BobbySavedPrompt(id, name, text))
                }
            }
        }
    }

    fun encodeStringList(values: Collection<String>): String {
        val array = JSONArray()
        values.forEach { value -> array.put(value) }
        return array.toString()
    }

    fun decodeStringList(raw: String?): List<String> {
        val array = parseArray(raw) ?: return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val value = array.optString(index).trim()
                if (value.isNotEmpty() && value !in this) add(value)
            }
        }
    }

    fun customActions(preferences: SharedPreferences): List<BobbyCustomAction> =
        decodeCustomActions(preferences.getString(CUSTOM_ACTIONS, "[]"))

    fun setCustomActions(
        preferences: SharedPreferences,
        values: List<BobbyCustomAction>
    ) {
        preferences.edit().putString(CUSTOM_ACTIONS, encodeCustomActions(values)).apply()
    }

    fun hiddenActionIds(preferences: SharedPreferences): Set<String> =
        decodeStringList(preferences.getString(HIDDEN_ACTIONS, "[]")).toSet()

    fun setHiddenActionIds(
        preferences: SharedPreferences,
        values: Collection<String>
    ) {
        preferences.edit().putString(HIDDEN_ACTIONS, encodeStringList(values)).apply()
    }

    fun actionOrder(preferences: SharedPreferences): List<String> =
        decodeStringList(preferences.getString(ACTION_ORDER, "[]"))

    fun setActionOrder(preferences: SharedPreferences, values: List<String>) {
        preferences.edit().putString(ACTION_ORDER, encodeStringList(values)).apply()
    }

    fun savedPrompts(preferences: SharedPreferences): List<BobbySavedPrompt> =
        decodeSavedPrompts(preferences.getString(SAVED_PROMPTS, "[]"))

    fun setSavedPrompts(
        preferences: SharedPreferences,
        values: List<BobbySavedPrompt>
    ) {
        preferences.edit().putString(SAVED_PROMPTS, encodeSavedPrompts(values)).apply()
    }

    fun resolveActions(preferences: SharedPreferences): List<BobbyTextAction> =
        BobbyActionCatalog.resolve(
            customActions = customActions(preferences),
            hiddenIds = hiddenActionIds(preferences),
            orderedIds = actionOrder(preferences)
        )

    fun selectedActionId(preferences: SharedPreferences): String {
        val available = resolveActions(preferences)
        val raw = preferences.getString(SELECTED_ACTION_ID, null)
            ?: preferences.getString(
                BobbyCredentialPreferences.SELECTED_ACTION,
                BobbyActionCatalog.clean.id
            )
        return normalizeSelectedActionId(raw, available)
    }

    fun setSelectedActionId(preferences: SharedPreferences, id: String) {
        preferences.edit().putString(SELECTED_ACTION_ID, id).apply()
    }

    fun normalizeSelectedActionId(
        selectedId: String?,
        availableActions: List<BobbyTextAction>
    ): String {
        val normalized = when (selectedId?.trim()?.lowercase()) {
            "clean" -> "clean"
            "summarize" -> "summarize"
            "sharpen" -> "sharpen"
            "ask" -> "ask"
            else -> selectedId?.trim()
        }
        return availableActions.firstOrNull { it.id == normalized }?.id ?: "clean"
    }

    private fun parseArray(raw: String?): JSONArray? {
        if (raw.isNullOrBlank()) return null
        return try {
            JSONArray(raw)
        } catch (_: Exception) {
            null
        }
    }
}

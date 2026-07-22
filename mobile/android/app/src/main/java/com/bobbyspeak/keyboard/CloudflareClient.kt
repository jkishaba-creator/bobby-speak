package com.bobbyspeak.keyboard

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL

data class CloudflareCredentials(
    val accountId: String,
    val apiToken: String
) {
    val isComplete: Boolean
        get() = accountId.isNotBlank() && apiToken.isNotBlank()

    companion object {
        fun fromRaw(accountId: String, apiToken: String): CloudflareCredentials {
            val normalizedToken = apiToken
                .trim()
                .replaceFirst(Regex("^Bearer\\s+", RegexOption.IGNORE_CASE), "")
                .replace("\\_", "_")

            return CloudflareCredentials(accountId.trim(), normalizedToken)
        }
    }
}

sealed interface CloudflareResult<out T> {
    data class Success<T>(val value: T) : CloudflareResult<T>

    data class Failure(
        val kind: CloudflareFailureKind,
        val message: String,
        val statusCode: Int? = null
    ) : CloudflareResult<Nothing>
}

enum class CloudflareFailureKind {
    CREDENTIALS,
    AUTHORIZATION,
    NOT_FOUND,
    RATE_LIMITED,
    TIMEOUT,
    NETWORK,
    MALFORMED_RESPONSE,
    PROVIDER
}

data class CloudflareHttpResponse(
    val statusCode: Int,
    val body: String
)

fun interface CloudflareTransport {
    fun post(url: URL, bearerToken: String, body: JSONObject): CloudflareHttpResponse
}

class CloudflareClient(
    private val transport: CloudflareTransport = UrlConnectionCloudflareTransport()
) {
    fun verify(credentials: CloudflareCredentials): CloudflareResult<Unit> {
        val body = JSONObject().apply {
            put(
                "messages",
                JSONArray().put(
                    JSONObject().apply {
                        put("role", "user")
                        put("content", "Reply with OK")
                    }
                )
            )
            put("max_tokens", 1)
        }

        return when (val result = runModel(credentials, TEXT_MODEL, body)) {
            is CloudflareResult.Success -> {
                if (result.value.optString("response").isBlank()) {
                    CloudflareResult.Failure(
                        CloudflareFailureKind.MALFORMED_RESPONSE,
                        "Cloudflare returned no verification response"
                    )
                } else {
                    CloudflareResult.Success(Unit)
                }
            }
            is CloudflareResult.Failure -> result
        }
    }

    fun transcribe(
        credentials: CloudflareCredentials,
        base64Audio: String
    ): CloudflareResult<String> {
        val body = JSONObject().apply {
            put("audio", base64Audio)
            put("task", "transcribe")
        }

        return when (val result = runModel(credentials, WHISPER_MODEL, body)) {
            is CloudflareResult.Success -> {
                val transcript = result.value.optString("text").trim()
                if (transcript.isEmpty()) {
                    CloudflareResult.Failure(
                        CloudflareFailureKind.PROVIDER,
                        "Cloudflare recognized no speech"
                    )
                } else {
                    CloudflareResult.Success(transcript)
                }
            }
            is CloudflareResult.Failure -> result
        }
    }

    fun polish(
        credentials: CloudflareCredentials,
        rawText: String
    ): CloudflareResult<String> {
        val messages = JSONArray().apply {
            put(
                JSONObject().apply {
                    put("role", "system")
                    put("content", SYSTEM_PROMPT)
                }
            )
            put(
                JSONObject().apply {
                    put("role", "user")
                    put("content", rawText)
                }
            )
        }
        val body = JSONObject().put("messages", messages)

        return when (val result = runModel(credentials, TEXT_MODEL, body)) {
            is CloudflareResult.Success -> {
                val polishedText = result.value.optString("response").trim()
                if (polishedText.isEmpty()) {
                    CloudflareResult.Failure(
                        CloudflareFailureKind.MALFORMED_RESPONSE,
                        "Cloudflare returned no formatted text"
                    )
                } else {
                    CloudflareResult.Success(polishedText)
                }
            }
            is CloudflareResult.Failure -> result
        }
    }

    private fun runModel(
        credentials: CloudflareCredentials,
        model: String,
        body: JSONObject
    ): CloudflareResult<JSONObject> {
        if (!credentials.isComplete) {
            return CloudflareResult.Failure(
                CloudflareFailureKind.CREDENTIALS,
                "Missing Cloudflare Account ID or API token"
            )
        }

        val url = URL("https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/ai/run/$model")
        val response = try {
            transport.post(url, credentials.apiToken, body)
        } catch (_: SocketTimeoutException) {
            return CloudflareResult.Failure(
                CloudflareFailureKind.TIMEOUT,
                "Cloudflare request timed out"
            )
        } catch (e: IOException) {
            return CloudflareResult.Failure(
                CloudflareFailureKind.NETWORK,
                e.localizedMessage ?: "Could not reach Cloudflare"
            )
        } catch (e: Exception) {
            return CloudflareResult.Failure(
                CloudflareFailureKind.PROVIDER,
                e.localizedMessage ?: "Cloudflare request failed"
            )
        }

        val envelope = try {
            JSONObject(response.body)
        } catch (_: Exception) {
            val message = if (response.statusCode in 200..299) {
                "Cloudflare returned an unreadable response"
            } else {
                "Cloudflare request failed (HTTP ${response.statusCode})"
            }
            return CloudflareResult.Failure(
                if (response.statusCode in 200..299) {
                    CloudflareFailureKind.MALFORMED_RESPONSE
                } else {
                    failureKindForStatus(response.statusCode)
                },
                message,
                response.statusCode
            )
        }

        if (response.statusCode !in 200..299 || !envelope.optBoolean("success", false)) {
            val message = firstEnvelopeMessage(envelope)
                ?: "Cloudflare request failed (HTTP ${response.statusCode})"
            return CloudflareResult.Failure(
                failureKindForStatus(response.statusCode),
                message,
                response.statusCode
            )
        }

        val modelResult = envelope.optJSONObject("result")
            ?: return CloudflareResult.Failure(
                CloudflareFailureKind.MALFORMED_RESPONSE,
                "Cloudflare response did not include a result",
                response.statusCode
            )

        return CloudflareResult.Success(modelResult)
    }

    private fun failureKindForStatus(statusCode: Int): CloudflareFailureKind {
        return when (statusCode) {
            401, 403 -> CloudflareFailureKind.AUTHORIZATION
            404 -> CloudflareFailureKind.NOT_FOUND
            429 -> CloudflareFailureKind.RATE_LIMITED
            else -> CloudflareFailureKind.PROVIDER
        }
    }

    private fun firstEnvelopeMessage(envelope: JSONObject): String? {
        for (key in listOf("errors", "messages")) {
            val items = envelope.optJSONArray(key) ?: continue
            for (index in 0 until items.length()) {
                val item = items.opt(index)
                val message = when (item) {
                    is JSONObject -> item.optString("message")
                    is String -> item
                    else -> ""
                }
                if (message.isNotBlank()) return message
            }
        }
        return null
    }

    companion object {
        private const val WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo"
        private const val TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
        private const val SYSTEM_PROMPT =
            "You correct dictated text. Fix grammar, punctuation, capitalization, and sentence boundaries " +
                "so it reads like clean writing. Remove filler words and false starts when that does not " +
                "change the meaning. Do not add, answer, or comment on the content. Reply with ONLY the " +
                "corrected text, no preamble or quotes."
    }
}

private class UrlConnectionCloudflareTransport : CloudflareTransport {
    override fun post(
        url: URL,
        bearerToken: String,
        body: JSONObject
    ): CloudflareHttpResponse {
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("Authorization", "Bearer $bearerToken")
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 60_000
        }

        return try {
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use {
                it.write(body.toString())
            }

            val statusCode = connection.responseCode
            val responseStream = if (statusCode in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }
            val responseBody = responseStream
                ?.bufferedReader(Charsets.UTF_8)
                ?.use { it.readText() }
                .orEmpty()

            CloudflareHttpResponse(statusCode, responseBody)
        } finally {
            connection.disconnect()
        }
    }
}

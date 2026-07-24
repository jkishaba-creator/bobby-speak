package com.bobbyspeak.keyboard

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URL

class CloudflareClientTest {

    @Test
    fun `transcribe normalizes credentials and extracts transcript`() {
        val transport = FakeTransport(
            CloudflareHttpResponse(
                200,
                """{"success":true,"result":{"text":"hello world"},"errors":[],"messages":[]}"""
            )
        )
        val client = CloudflareClient(transport)

        val result = client.transcribe(
            CloudflareCredentials.fromRaw(" account-id ", "Bearer cfut\\_example"),
            "base64-audio"
        )

        assertEquals(CloudflareResult.Success("hello world"), result)
        assertEquals("cfut_example", transport.lastBearerToken)
        assertTrue(transport.lastUrl.toString().endsWith("/accounts/account-id/ai/run/@cf/openai/whisper-large-v3-turbo"))
        assertEquals("base64-audio", transport.lastBody.getString("audio"))
        assertEquals("transcribe", transport.lastBody.getString("task"))
    }

    @Test
    fun `verify exercises the configured account against the production text model`() {
        val transport = FakeTransport(
            CloudflareHttpResponse(
                200,
                """{"success":true,"result":{"response":"OK"},"errors":[],"messages":[]}"""
            )
        )
        val client = CloudflareClient(transport)

        val result = client.verify(CloudflareCredentials.fromRaw("account-id", "token"))

        assertEquals(CloudflareResult.Success(Unit), result)
        assertTrue(transport.lastUrl.toString().endsWith("/accounts/account-id/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast"))
        assertEquals(1, transport.lastBody.getInt("max_tokens"))
        assertEquals("user", transport.lastBody.getJSONArray("messages").getJSONObject(0).getString("role"))
    }

    @Test
    fun `Cloudflare error envelope is returned instead of becoming empty speech`() {
        val transport = FakeTransport(
            CloudflareHttpResponse(
                403,
                """{"success":false,"result":null,"errors":[{"message":"Workers AI access denied"}],"messages":[]}"""
            )
        )
        val client = CloudflareClient(transport)

        val result = client.transcribe(
            CloudflareCredentials.fromRaw("account-id", "token"),
            "base64-audio"
        )

        assertTrue(result is CloudflareResult.Failure)
        result as CloudflareResult.Failure
        assertEquals(403, result.statusCode)
        assertEquals(CloudflareFailureKind.AUTHORIZATION, result.kind)
        assertEquals("Workers AI access denied", result.message)
    }

    @Test
    fun `polish extracts formatted response`() {
        val transport = FakeTransport(
            CloudflareHttpResponse(
                200,
                """{"success":true,"result":{"response":"Hello, world."},"errors":[],"messages":[]}"""
            )
        )
        val client = CloudflareClient(transport)

        val result = client.polish(
            CloudflareCredentials.fromRaw("account-id", "token"),
            "hello world"
        )

        assertEquals(CloudflareResult.Success("Hello, world."), result)
        val systemPrompt = transport.lastBody
            .getJSONArray("messages")
            .getJSONObject(0)
            .getString("content")
        assertTrue(systemPrompt.contains("Remove filler words"))
    }

    @Test
    fun `run action appends tone only to toneable actions`() {
        val transport = FakeTransport(
            CloudflareHttpResponse(
                200,
                """{"success":true,"result":{"response":"Done"},"errors":[],"messages":[]}"""
            )
        )
        val client = CloudflareClient(transport)
        val credentials = CloudflareCredentials.fromRaw("account-id", "token")

        client.runAction(
            credentials,
            "hello",
            BobbyActionCatalog.sharpen,
            ImeTone.CONFIDENT
        )
        val sharpenPrompt = transport.lastBody
            .getJSONArray("messages")
            .getJSONObject(0)
            .getString("content")
        assertTrue(sharpenPrompt.contains("confident tone"))

        client.runAction(
            credentials,
            "hello",
            BobbyActionCatalog.summarize,
            ImeTone.CONFIDENT
        )
        val summaryPrompt = transport.lastBody
            .getJSONArray("messages")
            .getJSONObject(0)
            .getString("content")
        assertTrue(!summaryPrompt.contains("confident tone"))
    }

    private class FakeTransport(
        private val response: CloudflareHttpResponse
    ) : CloudflareTransport {
        lateinit var lastUrl: URL
        lateinit var lastBearerToken: String
        lateinit var lastBody: JSONObject

        override fun post(url: URL, bearerToken: String, body: JSONObject): CloudflareHttpResponse {
            lastUrl = url
            lastBearerToken = bearerToken
            lastBody = body
            return response
        }
    }
}

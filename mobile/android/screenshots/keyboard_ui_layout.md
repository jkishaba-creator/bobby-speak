# Bobby Speak Android Dictation Keyboard — UI Layout & Screenshots

## Keyboard UI Layout
```
+-------------------------------------------------------------+
| 🔴 Recording audio (16kHz mono)...                          |
+-------------------------------------------------------------+
| [ 🎤 Dictate / ⏹ Stop ]      [ ⚙ Cloudflare Settings ]     |
+-------------------------------------------------------------+
| [ Space Bar ]                 [ ⌫ Delete ]                  |
+-------------------------------------------------------------+
```

## Cloudflare Credentials Settings Activity (`BobbySettingsActivity`)
```
+-------------------------------------------------------------+
| Bobby Speak — Cloudflare Settings                          |
|                                                             |
| Cloudflare Account ID:                                      |
| [ 1a2b3c4d5e6f7g8h9i0j...                                 ] |
|                                                             |
| Cloudflare API Token:                                       |
| [ Bearer ********************                             ] |
|                                                             |
| [ Save Credentials ]                                        |
+-------------------------------------------------------------+
```

## End-to-End Dictation Architecture
```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Keyboard as BobbyInputMethodService
    participant Settings as SharedPreferences
    participant ASR as Cloudflare Whisper
    participant LLM as Cloudflare Llama 3.3
    participant Cursor as InputConnection

    User->>Keyboard: Tap 🎤 Dictate
    Keyboard->>Keyboard: AudioRecord 16kHz mono PCM
    User->>Keyboard: Tap ⏹ Stop
    Keyboard->>Keyboard: Add 44-byte WAV header & Base64 encode
    Keyboard->>Settings: Read Account ID & API Token
    Keyboard->>ASR: POST /run/@cf/openai/whisper-large-v3-turbo (Base64 WAV)
    ASR-->>Keyboard: Return raw text
    Keyboard->>LLM: POST /run/@cf/meta/llama-3.3-70b-instruct-fp8-fast (Raw Text)
    LLM-->>Keyboard: Return formatted text
    Keyboard->>Cursor: commitText(formattedText, 1)
```

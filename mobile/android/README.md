# Bobby Speak — Native Android Dictation Keyboard MVP

Native Android Input Method Service (IME) for **Bobby Speak** (Issue #7).

Brings voice dictation & AI smart formatting to **any app on Android** (WhatsApp, Gmail, Notes, Twitter, SMS).

---

## Features Implemented (Issue #7)

1. **Native IME Scaffolding**:
   - `BobbyInputMethodService` registered with `BIND_INPUT_METHOD` permission.
   - `method.xml` defining the `en_US` keyboard subtype.

2. **16kHz Mono Audio Recording**:
   - Captures PCM audio at 16kHz mono 16-bit via `AudioRecord`.
   - Automatically prepends a 44-byte WAV header on stop and Base64 encodes the payload.

3. **Cloudflare AI Integration**:
   - **Speech-to-Text**: `POST /ai/run/@cf/openai/whisper-large-v3-turbo` with Base64 WAV payload.
   - **Smart Formatting**: `POST /ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast` for grammar correction and filler word removal.
   - **Text Insertion**: Inserts final text directly into cursor via `InputConnection.commitText()`.

4. **Settings Activity (`BobbySettingsActivity`)**:
   - Configurable Cloudflare Account ID and API Token saved securely in `SharedPreferences`.

5. **Permission Handling (`PermissionActivity`)**:
   - Handles runtime `RECORD_AUDIO` permission prompts for the IME.

---

## Project Structure

```
mobile/android/
├── README.md
├── build.gradle
├── settings.gradle
├── screenshots/
│   └── keyboard_ui_layout.md
└── app/
    ├── build.gradle
    └── src/main/
        ├── AndroidManifest.xml
        ├── res/xml/method.xml
        └── java/com/bobbyspeak/keyboard/
            ├── BobbyInputMethodService.kt
            ├── BobbySettingsActivity.kt
            └── PermissionActivity.kt
```

---

## How to Build & Enable on Android

1. **Open in Android Studio**: Open the `mobile/android` directory.
2. **Build APK**: Run `./gradlew assembleDebug` or click **Build → Make Project**.
3. **Enable Keyboard**:
   - Open Android **Settings → System → Languages & input → On-screen keyboard → Manage on-screen keyboards**.
   - Enable **Bobby Speak Dictation**.
4. **Configure Credentials**:
   - Tap **⚙ Settings** on the keyboard or open the Bobby Speak Settings app icon.
   - Enter your **Cloudflare Account ID** & **API Token** and tap **Save Credentials**.
5. **Start Dictating**: Open any app, switch to Bobby Speak Keyboard, and tap **🎤 Dictate**!

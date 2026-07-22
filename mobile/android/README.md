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

4. **Guided Android Setup (`BobbySettingsActivity`)**:
   - Shows whether Bobby is enabled, selected, and allowed to use the microphone.
   - Provides buttons for the Android IME settings and keyboard picker.
   - Includes a dedicated text field for testing Bobby without editing credentials.

5. **Workers AI Verification**:
   - Verifies the supplied account and token by running a tiny request against the same text model used by dictation.
   - Surfaces Cloudflare API errors instead of reporting them as "no speech."

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

## Build and Run on the Pixel Emulator

1. Start the Pixel emulator and open `mobile/android` in Android Studio, or build from WSL:

   ```bash
   ./gradlew :app:assembleDebug
   ```

   The wrapper detects a Windows Android SDK when it is run from WSL and uses the Windows JDK automatically.

2. Install and open **Bobby Speak Settings**.
3. Follow the three setup buttons in order:
   - **Enable Bobby Speak** opens Android's keyboard settings.
   - **Choose Bobby Speak** opens Android's input-method picker.
   - **Allow Microphone** requests recording permission.
4. Enter the Cloudflare Account ID and the raw API token (do not include the word `Bearer`), then tap **Save Credentials** and **Test & Verify Connection**.
5. Tap **Show Bobby Keyboard**, then use **TAP ME TO DICTATE**.

## Automated Emulator Proof

With exactly one emulator running, execute:

```bash
./scripts/verify-emulator.sh
```

The script builds and installs the APK, collapses the Android notification shade, proves Bobby's settings Activity is resumed, enables and selects the Bobby IME, focuses the dedicated test field, and asserts that Bobby owns a visible input window. Its proof screenshot is written to `build/reports/bobby-emulator/bobby-ime-proof.png` only after those assertions pass.

Set `BOBBY_ADB` or `BOBBY_DEVICE_SERIAL` when ADB is elsewhere or more than one emulator is connected. The script expects the `Pixel_7` AVD by default; set `BOBBY_EXPECTED_AVD` when intentionally testing another device profile.

Never keep Cloudflare credentials in `Cloudflare.md` or commit them to Git. Enter them only in the app, and rotate any token that has previously been stored in plaintext.

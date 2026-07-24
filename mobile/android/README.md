# Bobby Speak for Android

Native Android activity and Input Method Service (IME) for using Bobby Speak
inside any editable field.

## What is included

- Four-row QWERTY keyboard with shift, backspace, editor actions, keyboard
  switching, and password-field voice protection.
- Shared native `BobbyOrbView` in the activity and keyboard, including the
  blurred face, dotted ring, recording marker, level bars, and motion states.
- Cloudflare Workers AI transcription through Whisper and Type/Tone transforms
  through the configured text model.
- Built-in Types: Clean, Summarize, Sharpen, and Ask.
- Up to 12 editable custom Types, including ordering and visibility controls.
- Tone selection with action-specific tone rules.
- Up to 20 saved prompts. The activity can save/load them; the keyboard inserts
  them into the active input field.
- Transcript streaming, Clear, Save, Copy, and one-level Undo after a successful
  transform.
- Guided IME, microphone, and Cloudflare credential setup.

Unselected settings and management controls use muted grey surfaces. Black is
reserved for the selected Type/Tone pills and the enabled primary Copy action.
Orange is reserved for active recording feedback.

## Dictation behavior

1. Tap the orb to start recording.
2. Tap again to stop and transcribe.
3. Bobby resolves the currently selected Type and Tone.
4. The transformed result is copied in the activity or committed to the active
   external input field.
5. If transformation fails after transcription succeeds, Bobby preserves the
   raw transcript and displays a non-blocking error.

The native Android app intentionally continues to use the existing Cloudflare
Whisper transport. Chrome shortcut settings, extension output modes, Android
`SpeechRecognizer`, and Deepgram Flux are outside this Android parity work.

## Project structure

```text
mobile/android/
├── app/src/main/
│   ├── AndroidManifest.xml
│   ├── java/com/bobbyspeak/keyboard/
│   │   ├── BobbyContentModels.kt
│   │   ├── BobbyContentPreferences.kt
│   │   ├── BobbyDictationTransform.kt
│   │   ├── BobbyInputMethodService.kt
│   │   ├── BobbyKeyboardController.kt
│   │   ├── BobbyOrbView.kt
│   │   ├── BobbySettingsActivity.kt
│   │   ├── BobbyTranscriptHistory.kt
│   │   ├── BobbyWavEncoder.kt
│   │   ├── CloudflareClient.kt
│   │   └── PermissionActivity.kt
│   └── res/
├── app/src/test/
├── scripts/verify-emulator.sh
└── screenshots/
```

## Build and test

From `mobile/android`:

```powershell
java -classpath gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain clean :app:testDebugUnitTest :app:assembleDebug --no-daemon
```

Run Android lint separately:

```powershell
java -classpath gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain :app:lintDebug --no-daemon
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## Emulator verification

Start exactly one Pixel 7 emulator and run:

```bash
./scripts/verify-emulator.sh
```

The script builds and installs the APK, selects Bobby as the active IME, opens
an editable field in an external Android app, and verifies that Bobby's QWERTY
keys commit `bobby speak` through that app's active `InputConnection`.

Before a release, also manually verify:

- activity idle and recording states;
- keyboard idle, recording, and quick-settings states;
- selected Type/Tone dictation;
- one custom Type;
- saved-prompt insertion;
- password-field voice protection;
- raw-text fallback with a visible transform error;
- settings scrolling and management controls.

## Credentials

Enter the Cloudflare Account ID and raw API token only through the app. Do not
include the word `Bearer`. Credential scratch files are ignored by Git and must
never be staged or committed.

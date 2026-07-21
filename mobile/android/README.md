# Bobby Speak — Android Dictation Keyboard (Issue #7 Starter)

This directory contains the Android IME (Input Method Editor) implementation of Bobby Speak.

## Overview
As outlined in [Issue #6](https://github.com/jkishaba-creator/bobby-speak/issues/6) and [Issue #7](https://github.com/jkishaba-creator/bobby-speak/issues/7), this native Kotlin module provides a custom keyboard for Android devices that enables system-wide voice dictation using the same AI pipeline as the Bobby Speak Chrome Extension.

## Core Features
1. **InputMethodService**: Custom keyboard service (`BobbyInputMethodService.kt`).
2. **Audio Recorder**: Records 16kHz mono PCM/WAV audio when the microphone button is pressed.
3. **Cloudflare & Groq REST Client**: Sends audio to Cloudflare Workers AI (`@cf/openai/whisper-large-v3-turbo`) or Groq Whisper for transcription, followed by Llama 3.1 formatting.
4. **Text Insertion**: Commits cleaned, formatted text directly at the cursor via `InputConnection.commitText()`.
5. **Settings Activity**: Lets users configure their Cloudflare Account ID and API Token or Groq API Key.

## Build & Run
- Open `mobile/android` in Android Studio.
- Build & install on a device/emulator (`./gradlew assembleDebug`).
- Enable in **Settings → System → Languages & input → On-screen keyboard → Manage on-screen keyboards → Enable Bobby Speak**.

#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK_PATH="${PROJECT_DIR}/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE_NAME="com.bobbyspeak.keyboard"
SETTINGS_ACTIVITY="${PACKAGE_NAME}/.BobbySettingsActivity"
IME_ID="${PACKAGE_NAME}/.BobbyInputMethodService"
REPORT_DIR="${PROJECT_DIR}/build/reports/bobby-emulator"

if [[ -n "${BOBBY_ADB:-}" ]]; then
    ADB_BIN="${BOBBY_ADB}"
elif [[ -x /mnt/c/Users/clark/AppData/Local/Android/Sdk/platform-tools/adb.exe ]]; then
    ADB_BIN="/mnt/c/Users/clark/AppData/Local/Android/Sdk/platform-tools/adb.exe"
elif command -v adb >/dev/null; then
    ADB_BIN="$(command -v adb)"
else
    echo "FAIL: adb was not found. Set BOBBY_ADB to its path." >&2
    exit 1
fi

if [[ -n "${BOBBY_DEVICE_SERIAL:-}" ]]; then
    DEVICE_SERIAL="${BOBBY_DEVICE_SERIAL}"
else
    mapfile -t EMULATOR_SERIALS < <("${ADB_BIN}" devices | tr -d '\r' | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1 }')
    if [[ "${#EMULATOR_SERIALS[@]}" -ne 1 ]]; then
        echo "FAIL: expected exactly one running emulator; found ${#EMULATOR_SERIALS[@]}. Set BOBBY_DEVICE_SERIAL explicitly." >&2
        exit 1
    fi
DEVICE_SERIAL="${EMULATOR_SERIALS[0]}"
fi
EXPECTED_AVD_NAME="${BOBBY_EXPECTED_AVD:-Pixel_7}"

adb_for_device() {
    "${ADB_BIN}" -s "${DEVICE_SERIAL}" "$@"
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local description="$3"
    if [[ "${haystack}" != *"${needle}"* ]]; then
        echo "FAIL: ${description}. Expected to find: ${needle}" >&2
        exit 1
    fi
}

echo "[1/6] Building the debug APK"
(
    cd "${PROJECT_DIR}"
    ./gradlew :app:assembleDebug
)

if [[ ! -f "${APK_PATH}" ]]; then
    echo "FAIL: APK was not produced at ${APK_PATH}" >&2
    exit 1
fi

INSTALL_APK_PATH="${APK_PATH}"
if [[ "${ADB_BIN}" == *.exe ]] && command -v wslpath >/dev/null; then
    INSTALL_APK_PATH="$(wslpath -w "${APK_PATH}")"
fi

echo "[2/6] Installing on ${DEVICE_SERIAL}"
adb_for_device get-state >/dev/null
ACTUAL_AVD_NAME="$(adb_for_device shell getprop ro.boot.qemu.avd_name | tr -d '\r')"
if [[ -n "${EXPECTED_AVD_NAME}" && "${ACTUAL_AVD_NAME}" != "${EXPECTED_AVD_NAME}" ]]; then
    echo "FAIL: expected AVD ${EXPECTED_AVD_NAME}, but ${DEVICE_SERIAL} is ${ACTUAL_AVD_NAME:-unknown}" >&2
    exit 1
fi
echo "Target: ${ACTUAL_AVD_NAME:-${DEVICE_SERIAL}}"
adb_for_device install -r "${INSTALL_APK_PATH}" >/dev/null
adb_for_device shell settings put secure show_ime_with_hard_keyboard 1

echo "[3/6] Proving the Bobby launcher is foreground, not Android Home"
adb_for_device shell cmd statusbar collapse >/dev/null 2>&1 || true
adb_for_device shell am force-stop "${PACKAGE_NAME}"
LAUNCH_OUTPUT="$(adb_for_device shell am start -W -n "${SETTINGS_ACTIVITY}")"
assert_contains "${LAUNCH_OUTPUT}" "Status: ok" "Bobby settings did not launch"

RESUMED_ACTIVITY="$(adb_for_device shell dumpsys activity activities | grep -m1 'topResumedActivity\|mResumedActivity' || true)"
assert_contains "${RESUMED_ACTIVITY}" "${SETTINGS_ACTIVITY}" "Bobby settings is not Android's resumed activity"

adb_for_device shell uiautomator dump /sdcard/bobby-setup.xml >/dev/null
SETUP_XML="$(adb_for_device exec-out cat /sdcard/bobby-setup.xml)"
assert_contains "${SETUP_XML}" "Bobby enable input method" "the setup screen has no enable-keyboard step"
assert_contains "${SETUP_XML}" "Bobby choose input method" "the setup screen has no select-keyboard step"
assert_contains "${SETUP_XML}" "Bobby test input" "the setup screen has no dedicated keyboard test field"

echo "[4/6] Enabling and selecting the Bobby input method"
adb_for_device shell ime enable "${IME_ID}" >/dev/null
adb_for_device shell ime set "${IME_ID}" >/dev/null
adb_for_device shell pm grant "${PACKAGE_NAME}" android.permission.RECORD_AUDIO

# Keep Bobby selected: force-stopping the current IME makes Android fall back to
# another keyboard. Relaunch the Activity without force-stopping the package.
adb_for_device shell am start -W -n "${SETTINGS_ACTIVITY}" >/dev/null
adb_for_device shell uiautomator dump /sdcard/bobby-ready.xml >/dev/null
READY_XML="$(adb_for_device exec-out cat /sdcard/bobby-ready.xml)"

TEST_NODE="$(printf '%s' "${READY_XML}" | grep -o '<node[^>]*content-desc="Bobby show keyboard"[^>]*>' | head -n 1 || true)"
if [[ -z "${TEST_NODE}" ]]; then
    echo "FAIL: could not locate the Show Bobby Keyboard control in the Android UI tree" >&2
    exit 1
fi

TEST_BOUNDS="$(printf '%s' "${TEST_NODE}" | sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p')"
if [[ -z "${TEST_BOUNDS}" ]]; then
    echo "FAIL: Show Bobby Keyboard has no usable Android bounds" >&2
    exit 1
fi

read -r LEFT TOP RIGHT BOTTOM <<<"${TEST_BOUNDS}"
TAP_X=$(((LEFT + RIGHT) / 2))
TAP_Y=$(((TOP + BOTTOM) / 2))
adb_for_device shell input tap "${TAP_X}" "${TAP_Y}"
sleep 2

echo "[5/6] Asserting Bobby owns the visible input window"
SELECTED_IME="$(adb_for_device shell settings get secure default_input_method | tr -d '\r')"
if [[ "${SELECTED_IME}" != "${IME_ID}" ]]; then
    echo "FAIL: expected ${IME_ID} but Android selected ${SELECTED_IME}" >&2
    exit 1
fi

INPUT_METHOD_STATE="$(adb_for_device shell dumpsys input_method)"
assert_contains "${INPUT_METHOD_STATE}" "mCurImeId=${IME_ID}" "Bobby is not the current input method"
assert_contains "${INPUT_METHOD_STATE}" "mInputShown=true" "Bobby's input window is not shown"

mkdir -p "${REPORT_DIR}"
adb_for_device exec-out screencap -p > "${REPORT_DIR}/bobby-ime-proof.png"

echo "[6/6] Verification passed"
echo "PASS: ${SETTINGS_ACTIVITY} is resumed"
echo "PASS: ${IME_ID} is selected and visible"
echo "Proof: ${REPORT_DIR}/bobby-ime-proof.png"

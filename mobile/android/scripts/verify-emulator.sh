#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK_PATH="${PROJECT_DIR}/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE_NAME="com.bobbyspeak.keyboard"
SETTINGS_ACTIVITY="${PACKAGE_NAME}/.BobbySettingsActivity"
IME_ID="${PACKAGE_NAME}/.BobbyInputMethodService"
EXTERNAL_SETTINGS_PACKAGE="com.android.settings"
EXTERNAL_SEARCH_PACKAGE="com.google.android.settings.intelligence"
EXTERNAL_SEARCH_FIELD_ID="${EXTERNAL_SEARCH_PACKAGE}:id/open_search_view_edit_text"
EXTERNAL_CLEAR_BUTTON_ID="${EXTERNAL_SEARCH_PACKAGE}:id/open_search_view_clear_button"
REPORT_DIR="${PROJECT_DIR}/build/reports/bobby-emulator"
SCREENSHOT_DIR="${PROJECT_DIR}/screenshots/final-parity"

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

dump_ui() {
    local device_path="$1"
    local attempt
    for attempt in 1 2 3 4; do
        if adb_for_device shell timeout 8 \
            uiautomator dump --compressed "${device_path}" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    echo "FAIL: Android UI hierarchy did not become idle for ${device_path}" >&2
    return 1
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

echo "[1/7] Building the debug APK"
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

echo "[2/7] Installing on ${DEVICE_SERIAL}"
adb_for_device get-state >/dev/null
ACTUAL_AVD_NAME="$(adb_for_device shell getprop ro.boot.qemu.avd_name | tr -d '\r')"
if [[ -n "${EXPECTED_AVD_NAME}" && "${ACTUAL_AVD_NAME}" != "${EXPECTED_AVD_NAME}" ]]; then
    echo "FAIL: expected AVD ${EXPECTED_AVD_NAME}, but ${DEVICE_SERIAL} is ${ACTUAL_AVD_NAME:-unknown}" >&2
    exit 1
fi
echo "Target: ${ACTUAL_AVD_NAME:-${DEVICE_SERIAL}}"
adb_for_device install -r "${INSTALL_APK_PATH}" >/dev/null
adb_for_device shell settings put secure show_ime_with_hard_keyboard 1

echo "[3/7] Checking Bobby's setup entry point"
adb_for_device shell cmd statusbar collapse >/dev/null 2>&1 || true
adb_for_device shell am force-stop "${PACKAGE_NAME}"
LAUNCH_OUTPUT="$(adb_for_device shell am start -W -n "${SETTINGS_ACTIVITY}")"
assert_contains "${LAUNCH_OUTPUT}" "Status: ok" "Bobby settings did not launch"

RESUMED_ACTIVITY="$(adb_for_device shell dumpsys activity activities | grep -m1 'topResumedActivity\|mResumedActivity' || true)"
assert_contains "${RESUMED_ACTIVITY}" "${SETTINGS_ACTIVITY}" "Bobby settings is not Android's resumed activity"

dump_ui /sdcard/bobby-setup.xml
SETUP_XML="$(adb_for_device exec-out cat /sdcard/bobby-setup.xml)"
assert_contains "${SETUP_XML}" "Bobby enable input method" "the setup screen has no enable-keyboard step"
assert_contains "${SETUP_XML}" "Bobby choose input method" "the setup screen has no select-keyboard step"
assert_contains "${SETUP_XML}" "Bobby test input" "the setup screen has no dedicated keyboard test field"

echo "[4/7] Enabling and selecting the Bobby input method"
adb_for_device shell ime enable "${IME_ID}" >/dev/null
adb_for_device shell ime set "${IME_ID}" >/dev/null
adb_for_device shell pm grant "${PACKAGE_NAME}" android.permission.RECORD_AUDIO

echo "[5/7] Opening Bobby over Android Settings"
adb_for_device shell am force-stop "${EXTERNAL_SEARCH_PACKAGE}"
adb_for_device shell am force-stop "${EXTERNAL_SETTINGS_PACKAGE}"
EXTERNAL_LAUNCH_OUTPUT="$(adb_for_device shell am start -W -a android.settings.SETTINGS)"
assert_contains "${EXTERNAL_LAUNCH_OUTPUT}" "Status: ok" "Android Settings did not launch"

EXTERNAL_RESUMED_ACTIVITY="$(adb_for_device shell dumpsys activity activities | grep -m1 'topResumedActivity\|mResumedActivity' || true)"
assert_contains "${EXTERNAL_RESUMED_ACTIVITY}" "${EXTERNAL_SETTINGS_PACKAGE}" "Android Settings is not the resumed external app"
if [[ "${EXTERNAL_RESUMED_ACTIVITY}" == *"${PACKAGE_NAME}"* ]]; then
    echo "FAIL: cross-app proof is still running inside Bobby Speak" >&2
    exit 1
fi

dump_ui /sdcard/bobby-external-settings.xml
EXTERNAL_SETTINGS_XML="$(adb_for_device exec-out cat /sdcard/bobby-external-settings.xml)"
SEARCH_NODE="$(printf '%s' "${EXTERNAL_SETTINGS_XML}" | grep -o '<node[^>]*resource-id="com.android.settings:id/search_action_bar"[^>]*>' | head -n 1 || true)"
if [[ -z "${SEARCH_NODE}" ]]; then
    echo "FAIL: could not locate Android Settings' search control" >&2
    exit 1
fi

SEARCH_BOUNDS="$(printf '%s' "${SEARCH_NODE}" | sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p')"
if [[ -z "${SEARCH_BOUNDS}" ]]; then
    echo "FAIL: Android Settings' search control has no usable bounds" >&2
    exit 1
fi

read -r LEFT TOP RIGHT BOTTOM <<<"${SEARCH_BOUNDS}"
TAP_X=$(((LEFT + RIGHT) / 2))
TAP_Y=$(((TOP + BOTTOM) / 2))
adb_for_device shell input tap "${TAP_X}" "${TAP_Y}"
sleep 2

EXTERNAL_SEARCH_ACTIVITY="$(adb_for_device shell dumpsys activity activities | grep -m1 'topResumedActivity\|mResumedActivity' || true)"
assert_contains "${EXTERNAL_SEARCH_ACTIVITY}" "${EXTERNAL_SEARCH_PACKAGE}" "Android Settings search is not resumed"

dump_ui /sdcard/bobby-external-search.xml
EXTERNAL_SEARCH_XML="$(adb_for_device exec-out cat /sdcard/bobby-external-search.xml)"
EXTERNAL_FIELD_NODE="$(printf '%s' "${EXTERNAL_SEARCH_XML}" | grep -o "<node[^>]*resource-id=\"${EXTERNAL_SEARCH_FIELD_ID}\"[^>]*>" | head -n 1 || true)"
if [[ -z "${EXTERNAL_FIELD_NODE}" ]]; then
    echo "FAIL: the external Settings field is missing" >&2
    exit 1
fi
assert_contains "${EXTERNAL_FIELD_NODE}" "focused=\"true\"" "the external Settings field is not focused"

if [[ "${EXTERNAL_FIELD_NODE}" != *"text=\"\""* && \
      "${EXTERNAL_FIELD_NODE}" != *"text=\"Search settings\""* ]]; then
    CLEAR_NODE="$(printf '%s' "${EXTERNAL_SEARCH_XML}" | grep -o "<node[^>]*resource-id=\"${EXTERNAL_CLEAR_BUTTON_ID}\"[^>]*>" | head -n 1 || true)"
    if [[ -z "${CLEAR_NODE}" ]]; then
        echo "FAIL: Android Settings retained a query but exposed no clear button" >&2
        exit 1
    fi
    CLEAR_BOUNDS="$(printf '%s' "${CLEAR_NODE}" | sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p')"
    read -r CLEAR_LEFT CLEAR_TOP CLEAR_RIGHT CLEAR_BOTTOM <<<"${CLEAR_BOUNDS}"
    adb_for_device shell input tap \
        "$(((CLEAR_LEFT + CLEAR_RIGHT) / 2))" \
        "$(((CLEAR_TOP + CLEAR_BOTTOM) / 2))"
    sleep 1
    dump_ui /sdcard/bobby-external-search-empty.xml
    EXTERNAL_SEARCH_XML="$(adb_for_device exec-out cat /sdcard/bobby-external-search-empty.xml)"
    EXTERNAL_FIELD_NODE="$(printf '%s' "${EXTERNAL_SEARCH_XML}" | grep -o "<node[^>]*resource-id=\"${EXTERNAL_SEARCH_FIELD_ID}\"[^>]*>" | head -n 1 || true)"
fi

echo "[6/7] Proving Bobby owns the external input connection"
SELECTED_IME="$(adb_for_device shell settings get secure default_input_method | tr -d '\r')"
if [[ "${SELECTED_IME}" != "${IME_ID}" ]]; then
    echo "FAIL: expected ${IME_ID} but Android selected ${SELECTED_IME}" >&2
    exit 1
fi

INPUT_METHOD_STATE="$(adb_for_device shell dumpsys input_method)"
assert_contains "${INPUT_METHOD_STATE}" "mCurImeId=${IME_ID}" "Bobby is not the current input method"
assert_contains "${INPUT_METHOD_STATE}" "mInputShown=true" "Bobby's input window is not shown"
assert_contains "${INPUT_METHOD_STATE}" "open_search_view_edit_text" "Bobby is not connected to Android Settings' text field"

# Tap Bobby's own rendered QWERTY keys. The key centers are derived from the
# active IME frame, screen width, Android density, and the checked-in row weights.
# This proves InputConnection.commitText(), rather than ADB text injection.
if [[ "${EXTERNAL_FIELD_NODE}" != *"text=\"\""* && \
      "${EXTERNAL_FIELD_NODE}" != *"text=\"Search settings\""* ]]; then
    echo "FAIL: the external field was not empty before Bobby typed" >&2
    exit 1
fi

SCREEN_WIDTH="$(adb_for_device shell wm size | tr -d '\r' | awk -F': ' '/size:/ { split($2, size, "x"); width=size[1] } END { print width }')"
DENSITY_DPI="$(adb_for_device shell wm density | tr -d '\r' | awk -F': ' '/density:/ { density=$2 } END { print density }')"
WINDOW_STATE="$(adb_for_device shell dumpsys window)"
IME_TOP="$(printf '%s' "${WINDOW_STATE}" | sed -n 's/.*type=ime frame=\[[0-9][0-9]*,\([0-9][0-9]*\)\]\[[0-9][0-9]*,[0-9][0-9]*\] visible=true.*/\1/p' | head -n 1)"

if [[ -z "${SCREEN_WIDTH}" || -z "${DENSITY_DPI}" || -z "${IME_TOP}" ]]; then
    echo "FAIL: could not resolve Bobby's visible keyboard geometry" >&2
    exit 1
fi

DENSITY="$(awk -v dpi="${DENSITY_DPI}" 'BEGIN { print dpi / 160 }')"
KEYBOARD_EDGE="$(awk -v density="${DENSITY}" 'BEGIN { print 4 * density }')"
KEYBOARD_WIDTH="$(awk -v width="${SCREEN_WIDTH}" -v edge="${KEYBOARD_EDGE}" 'BEGIN { print width - (2 * edge) }')"
Q_ROW_Y="$(awk -v top="${IME_TOP}" -v density="${DENSITY}" 'BEGIN { printf "%d", top + (171 * density) }')"
A_ROW_Y="$(awk -v top="${IME_TOP}" -v density="${DENSITY}" 'BEGIN { printf "%d", top + (223 * density) }')"
Z_ROW_Y="$(awk -v top="${IME_TOP}" -v density="${DENSITY}" 'BEGIN { printf "%d", top + (275 * density) }')"
BOTTOM_ROW_Y="$(awk -v top="${IME_TOP}" -v density="${DENSITY}" 'BEGIN { printf "%d", top + (338 * density) }')"

tap_bobby_letter() {
    local letter="$1"
    local letters=""
    local row_y=""
    local leading_weight="0"
    local total_weight=""

    case "${letter}" in
        [qwertyuiop]) letters="qwertyuiop"; row_y="${Q_ROW_Y}"; total_weight="10" ;;
        [asdfghjkl]) letters="asdfghjkl"; row_y="${A_ROW_Y}"; leading_weight="0.45"; total_weight="9.9" ;;
        [zxcvbnm]) letters="zxcvbnm"; row_y="${Z_ROW_Y}"; leading_weight="1.35"; total_weight="9.7" ;;
        *) echo "FAIL: unsupported Bobby verification key: ${letter}" >&2; exit 1 ;;
    esac

    local prefix="${letters%%${letter}*}"
    local key_index="${#prefix}"
    local tap_x
    tap_x="$(awk \
        -v edge="${KEYBOARD_EDGE}" \
        -v width="${KEYBOARD_WIDTH}" \
        -v total="${total_weight}" \
        -v leading="${leading_weight}" \
        -v key_index="${key_index}" \
        'BEGIN { printf "%d", edge + ((leading + key_index + 0.5) * width / total) }')"
    adb_for_device shell input tap "${tap_x}" "${row_y}"
    sleep 0.12
}

tap_bobby_space() {
    local tap_x
    tap_x="$(awk \
        -v edge="${KEYBOARD_EDGE}" \
        -v width="${KEYBOARD_WIDTH}" \
        'BEGIN { printf "%d", edge + (4.35 * width / 8.9) }')"
    adb_for_device shell input tap "${tap_x}" "${BOTTOM_ROW_Y}"
    sleep 0.12
}

tap_bobby_letter b
tap_bobby_letter o
tap_bobby_letter b
tap_bobby_letter b
tap_bobby_letter y
tap_bobby_space
tap_bobby_letter s
tap_bobby_letter p
tap_bobby_letter e
tap_bobby_letter a
tap_bobby_letter k
sleep 3

dump_ui /sdcard/bobby-external-insertion.xml
EXTERNAL_INSERTION_XML="$(adb_for_device exec-out cat /sdcard/bobby-external-insertion.xml)"
EXTERNAL_INSERTION_NODE="$(printf '%s' "${EXTERNAL_INSERTION_XML}" | grep -o "<node[^>]*resource-id=\"${EXTERNAL_SEARCH_FIELD_ID}\"[^>]*>" | head -n 1 || true)"
if [[ -z "${EXTERNAL_INSERTION_NODE}" ]]; then
    echo "FAIL: the verified text is not in Android Settings" >&2
    exit 1
fi
assert_contains "${EXTERNAL_INSERTION_NODE}" "text=\"bobby speak\"" "Bobby's own QWERTY keys did not type into Android Settings"

mkdir -p "${REPORT_DIR}" "${SCREENSHOT_DIR}"
adb_for_device exec-out screencap -p > "${REPORT_DIR}/bobby-external-app-proof.png"
cp "${REPORT_DIR}/bobby-external-app-proof.png" \
    "${SCREENSHOT_DIR}/keyboard-idle.png"

echo "[7/7] Verification passed"
echo "PASS: ${IME_ID} is selected and visible over ${EXTERNAL_SEARCH_PACKAGE}"
echo "PASS: Bobby's own QWERTY keys typed 'bobby speak' into Android Settings"
echo "Proof: ${REPORT_DIR}/bobby-external-app-proof.png"
echo "Screenshot: ${SCREENSHOT_DIR}/keyboard-idle.png"

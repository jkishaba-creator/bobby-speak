#!/usr/bin/env node
// Bobby Speak test suite — no dependencies, no build step.
//   node test/run-tests.js
// Runs in CI on every pull request.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log("  ✗ " + name + "\n      " + err.message);
  }
}

function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      (label ? label + ": " : "") +
        "expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)
    );
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// ---------------------------------------------------------------- manifest
console.log("\nmanifest");

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

check("is valid JSON with manifest_version 3", () => {
  eq(manifest.manifest_version, 3);
});

check("declares name, version and description", () => {
  assert(manifest.name, "missing name");
  assert(/^\d+\.\d+\.\d+$/.test(manifest.version), "version must be x.y.z");
  assert(manifest.description, "missing description");
});

check("every file it references exists", () => {
  const refs = [
    manifest.background && manifest.background.service_worker,
    manifest.action && manifest.action.default_popup,
    manifest.options_page,
    ...(manifest.content_scripts || []).flatMap((cs) => cs.js || []),
    ...Object.values((manifest.action && manifest.action.default_icon) || {}),
    ...Object.values(manifest.icons || {}),
  ].filter(Boolean);
  for (const ref of refs) {
    assert(fs.existsSync(path.join(root, ref)), "missing file referenced by manifest: " + ref);
  }
});

check("html entry points exist for every window", () => {
  for (const page of ["popup.html", "options.html", "popout.html", "offscreen.html", "permission.html"]) {
    assert(fs.existsSync(path.join(root, page)), "missing " + page);
  }
});

// ------------------------------------------------------------------ syntax
console.log("\nsyntax");

function jsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(full, acc);
    else if (entry.name.endsWith(".js")) acc.push(full);
  }
  return acc;
}

for (const file of jsFiles(root)) {
  const rel = path.relative(root, file);
  check(rel + " parses", () => {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  });
}

// ------------------------------------------------------- text cleanup rules
console.log("\ntext cleanup");

const { TextCleanup } = require(path.join(root, "lib", "textCleanup.js"));

const cleanupCases = [
  ["removes fillers", "um so i think we should ship it", {}, "So I think we should ship it."],
  ["collapses stutters", "the the deploy is is ready", {}, "The deploy is ready."],
  ["capitalizes standalone i", "i'm sure i'll go", {}, "I'm sure I'll go."],
  ["adds a terminal period", "is this working", {}, "Is this working."],
  ["spoken period and question mark", "hello world period how are you question mark", {}, "Hello world. How are you?"],
  ["spoken comma", "meet me tomorrow comma maybe at noon period", {}, "Meet me tomorrow, maybe at noon."],
  ["spoken new line", "first point new line second point", {}, "First point\nSecond point."],
  ["spoken new paragraph", "dear team new paragraph the launch is friday", {}, "Dear team\n\nThe launch is friday."],
  ["respects spokenPunctuation off", "this stays period", { spokenPunctuation: false }, "This stays period."],
  ["fuzzy-corrects custom words", "i talked to kubernets yesterday", { customWords: ["Kubernetes"] }, "I talked to Kubernetes yesterday."],
  ["fixes casing of exact custom words", "we use postgresql here", { customWords: ["PostgreSQL"] }, "We use PostgreSQL here."],
  ["leaves unrelated words alone", "the giraffe is tall", { customWords: ["Kubernetes"] }, "The giraffe is tall."],
  ["handles empty input", "", {}, ""],
];

for (const [name, input, opts, expected] of cleanupCases) {
  check(name, () => eq(TextCleanup.clean(input, opts), expected));
}

// ------------------------------------------------------------ audio helpers
console.log("\naudio helpers");

if (typeof globalThis.btoa !== "function") {
  globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
}
const { Engines } = require(path.join(root, "lib", "engines.js"));

check("downsamples 48 kHz to 16 kHz", () => {
  const input = new Float32Array(4800);
  for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
  eq(Engines.downsampleTo16k(input, 48000).length, 1600);
});

check("passes 16 kHz through unchanged in length", () => {
  eq(Engines.downsampleTo16k(new Float32Array(1600), 16000).length, 1600);
});

check("clamps samples to the Int16 range", () => {
  const out = Engines.downsampleTo16k(new Float32Array([1.5, -1.5]), 16000);
  eq(out[0], 32767, "positive clip");
  eq(out[1], -32768, "negative clip");
});

check("preserves signal amplitude", () => {
  const input = new Float32Array(1600);
  for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * 440 * i) / 16000);
  const peak = Math.max(...Array.from(Engines.downsampleTo16k(input, 16000)).map(Math.abs));
  assert(peak > 30000, "peak too low: " + peak);
});

check("writes a valid 16 kHz mono WAV header", () => {
  const wav = Engines.encodeWav16k(new Int16Array(1600));
  eq(Buffer.from(wav.slice(0, 4)).toString(), "RIFF", "riff tag");
  eq(Buffer.from(wav.slice(8, 12)).toString(), "WAVE", "wave tag");
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  eq(view.getUint16(22, true), 1, "channel count");
  eq(view.getUint32(24, true), 16000, "sample rate");
  eq(view.getUint16(34, true), 16, "bits per sample");
  eq(wav.length, 44 + 3200, "total size");
});

check("base64-encodes bytes", () => {
  eq(Engines.bytesToBase64(new Uint8Array([82, 73, 70, 70])), "UklGRg==");
});

check("base64 handles buffers larger than one chunk", () => {
  const big = new Uint8Array(100000).fill(65);
  const out = Engines.bytesToBase64(big);
  eq(Buffer.from(out, "base64").length, 100000);
});

check("isBatch only flags the batch engine", () => {
  eq(Engines.isBatch("cf-whisper"), true);
  eq(Engines.isBatch("cf-flux"), false);
  eq(Engines.isBatch("chrome"), false);
});

check("creates each engine without throwing", () => {
  const noop = () => {};
  const cb = { onTentative: noop, onSegment: noop, onDone: noop, onError: noop };
  for (const kind of ["chrome", "cf-whisper", "cf-flux"]) {
    const engine = Engines.create(kind, {}, cb);
    assert(typeof engine.start === "function", kind + " has no start()");
    assert(typeof engine.stop === "function", kind + " has no stop()");
  }
});

// ------------------------------------------------------------------ results
console.log(
  "\n" +
    (failures.length === 0
      ? `All ${passed} checks passed.`
      : `${passed} passed, ${failures.length} FAILED:\n` +
        failures.map((f) => "  ✗ " + f.name + " — " + f.message).join("\n"))
);
process.exit(failures.length === 0 ? 0 : 1);

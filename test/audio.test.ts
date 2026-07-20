// v1's audio-helper suite, ported. Pure math — runs anywhere.

import { describe, expect, it } from "vitest";
import {
  bytesToBase64,
  downsampleTo16k,
  encodeWav16k,
} from "../src/audio/resample";

describe("downsampleTo16k", () => {
  it("downsamples 48 kHz to 16 kHz", () => {
    const input = new Float32Array(4800);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    }
    expect(downsampleTo16k(input, 48000).length).toBe(1600);
  });

  it("passes 16 kHz through unchanged in length", () => {
    expect(downsampleTo16k(new Float32Array(1600), 16000).length).toBe(1600);
  });

  it("clamps samples to the Int16 range", () => {
    const out = downsampleTo16k(new Float32Array([1.5, -1.5]), 16000);
    expect(out[0]).toBe(32767);
    expect(out[1]).toBe(-32768);
  });

  it("preserves signal amplitude", () => {
    const input = new Float32Array(1600);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / 16000);
    }
    const peak = Math.max(
      ...Array.from(downsampleTo16k(input, 16000)).map(Math.abs),
    );
    expect(peak).toBeGreaterThan(30000);
  });
});

describe("encodeWav16k", () => {
  it("writes a valid 16 kHz mono WAV header", () => {
    const wav = encodeWav16k(new Int16Array(1600));
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(wav.length).toBe(44 + 3200);
  });
});

describe("bytesToBase64", () => {
  it("encodes bytes", () => {
    expect(bytesToBase64(new Uint8Array([82, 73, 70, 70]))).toBe("UklGRg==");
  });

  it("handles buffers larger than one chunk", () => {
    const big = new Uint8Array(100000).fill(65);
    const out = bytesToBase64(big);
    expect(atob(out).length).toBe(100000);
  });
});

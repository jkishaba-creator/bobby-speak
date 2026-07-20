// AudioWorklet processor: taps mic samples off the audio thread and posts
// them to the main thread in ~2048-sample batches (≈43 ms at 48 kHz).
// Outputs are left silent — the destination connection only drives processing.
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      this.chunks.push(new Float32Array(channel));
      this.length += channel.length;
      if (this.length >= 2048) {
        const out = new Float32Array(this.length);
        let offset = 0;
        for (const chunk of this.chunks) {
          out.set(chunk, offset);
          offset += chunk.length;
        }
        this.port.postMessage(out, [out.buffer]);
        this.chunks = [];
        this.length = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-tap", PcmTap);

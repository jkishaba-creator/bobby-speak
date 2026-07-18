// One-time mic permission grant for the extension origin.
// Once granted here, the offscreen document can capture without prompting.

document.getElementById("enableBtn").addEventListener("click", async () => {
  const ok = document.getElementById("ok");
  const fail = document.getElementById("fail");
  ok.style.display = "none";
  fail.style.display = "none";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    ok.style.display = "block";
  } catch (_) {
    fail.style.display = "block";
  }
});

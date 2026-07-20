// One-time mic grant for the extension origin; once granted here, the
// offscreen pipeline can capture without prompting.
import "../../assets/tailwind.css";

document.getElementById("app")!.innerHTML = `
  <main class="grid min-h-screen place-items-center bg-stage p-6 font-sans text-ink">
    <div class="flex max-w-[420px] flex-col items-center gap-4 text-center">
      <div class="text-[17px] font-bold">Bobby <span class="text-lite">Speak</span></div>
      <h1 class="text-2xl font-bold tracking-tight">One-time microphone access</h1>
      <p class="text-sm text-grey">Dictation runs through your mic. Chrome asks once for this
        extension — after that, the shortcut works on any page.</p>
      <button id="enable" class="pillbtn pillbtn-dark">Enable microphone</button>
      <p id="ok" class="hidden text-sm font-semibold text-green-700">Done — you can close this tab and dictate anywhere.</p>
      <p id="fail" class="hidden text-sm font-semibold text-red-700">Blocked. Click the mic icon in the address bar to allow access, then try again.</p>
    </div>
  </main>`;

document.getElementById("enable")!.addEventListener("click", async () => {
  const ok = document.getElementById("ok")!;
  const fail = document.getElementById("fail")!;
  ok.classList.add("hidden");
  fail.classList.add("hidden");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    ok.classList.remove("hidden");
  } catch {
    fail.classList.remove("hidden");
  }
});

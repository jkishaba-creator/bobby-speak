// Extension layer: content script. Hosts the output layer (overlay pill +
// insertion) inside the page. No pipeline logic here.

import { insertText, trackFocus } from "../src/output/inject";
import * as overlay from "../src/output/overlay";
import type { ContentMessage } from "../src/shared/types";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    // Manifest injection + on-demand injection must never both run.
    if ((window as any).__bobbySpeakLoaded) return;
    (window as any).__bobbySpeakLoaded = true;

    trackFocus();

    chrome.runtime.onMessage.addListener(
      (msg: ContentMessage, _sender, sendResponse) => {
        switch (msg?.type) {
          case "ping":
            sendResponse({ ok: true });
            return;
          case "overlay-show":
            overlay.showListening();
            break;
          case "overlay-processing":
            overlay.showProcessing();
            break;
          case "overlay-level":
            overlay.setLevels(msg.levels);
            break;
          case "overlay-text":
            overlay.setText(msg.committed, msg.tentative);
            break;
          case "overlay-error":
            overlay.showError(msg.message);
            break;
          case "overlay-hide":
            overlay.hide();
            break;
          case "insert-text":
            void insertText(msg.text).then((result) => {
              if (result === "clipboard") {
                const isMac = navigator.platform.toLowerCase().includes("mac");
                overlay.showError(
                  "Copied — press " + (isMac ? "⌘V" : "Ctrl+V") + " to paste",
                );
                setTimeout(overlay.hide, 2200);
              }
            });
            break;
        }
      },
    );
  },
});

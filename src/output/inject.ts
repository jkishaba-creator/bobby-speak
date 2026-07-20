// Output layer: put processed text where the user's cursor is.
// Ported from v1's content.js — handles inputs, textareas, contenteditable,
// React-controlled fields, and falls back to the clipboard for canvas editors.

let lastEditable: HTMLElement | null = null;

export function trackFocus(): void {
  document.addEventListener(
    "focusin",
    (e) => {
      if (isEditable(e.target as HTMLElement)) {
        lastEditable = e.target as HTMLElement;
      }
    },
    true,
  );
}

function isEditable(el: HTMLElement | null): boolean {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") {
    const ta = el as HTMLTextAreaElement;
    return !ta.disabled && !ta.readOnly;
  }
  if (tag === "INPUT") {
    const input = el as HTMLInputElement;
    const type = (input.getAttribute("type") ?? "text").toLowerCase();
    const texty = ["text", "search", "email", "url", "tel", "number", ""];
    return texty.includes(type) && !input.disabled && !input.readOnly;
  }
  return el.isContentEditable;
}

export type InsertResult = "inserted" | "clipboard" | "no-target";

export async function insertText(text: string): Promise<InsertResult> {
  const active = document.activeElement as HTMLElement | null;
  const el = active && isEditable(active) ? active : lastEditable;

  if (el && document.contains(el)) {
    el.focus();
    // Deprecated but still the only insertion path that is undo-friendly and
    // fires the right events in both inputs and contenteditable.
    if (document.execCommand("insertText", false, text)) return "inserted";
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      insertIntoField(el as HTMLInputElement | HTMLTextAreaElement, text);
      return "inserted";
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return "clipboard";
  } catch {
    return "no-target";
  }
}

// React-controlled fields ignore .value writes; go through the native setter
// and fire an InputEvent so the framework sees the change.
function insertIntoField(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): void {
  const proto =
    el.tagName === "INPUT"
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  setter.call(el, el.value.slice(0, start) + text + el.value.slice(end));
  el.dispatchEvent(
    new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }),
  );
  const pos = start + text.length;
  try {
    el.setSelectionRange(pos, pos);
  } catch {
    /* number inputs don't support selection */
  }
}

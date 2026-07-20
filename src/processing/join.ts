// Segment joining. Chrome's speech engine capitalizes the first word of
// EVERY recognition result, and a new result starts at every pause — so
// naive concatenation strands capitals mid-sentence ("make sure that It
// works"). When the previous text doesn't end a sentence, the incoming
// segment's leading capital is almost always an artifact: lowercase it.
//
// Kept capitalized: "I" and its contractions, the user's custom words
// (their spelling is the whole point), and all-caps acronyms.

export function joinSegments(
  prev: string,
  next: string,
  customWords: string[],
): string {
  const prevTrim = prev.trimEnd();
  let seg = next.trimStart();
  if (!prevTrim) return next;
  if (!seg) return prev;

  const midSentence = !/[.!?…\n]$/.test(prevTrim);
  if (midSentence) {
    const match = seg.match(/^([A-Za-zÀ-ÿ][\w'’-]*)/);
    if (match) {
      const word = match[1];
      const isI = word === "I" || /^I['’]/.test(word);
      const isCustom = customWords.some(
        (cw) => cw.toLowerCase() === word.toLowerCase(),
      );
      const isAcronym = word.length > 1 && word === word.toUpperCase();
      if (!isI && !isCustom && !isAcronym && /^[A-ZÀ-Þ]/.test(word)) {
        seg = word.charAt(0).toLowerCase() + seg.slice(1);
      }
    }
  }
  return prevTrim + " " + seg;
}

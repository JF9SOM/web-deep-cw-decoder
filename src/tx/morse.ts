// Pure Morse timing helpers. No browser APIs here so they stay testable.

const MORSE: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.",
  H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.",
  O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-",
  V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
  ",": "--..--", ".": ".-.-.-", "/": "-..-.", "?": "..--..", "=": "-...-",
  "-": "-....-", "+": ".-.-.",
};

// Prosigns written as <XX>; sent as a single run-together character.
const PROSIGNS: Record<string, string> = {
  AR: ".-.-.",
  SK: "...-.-",
  BT: "-...-",
  KN: "-.--.",
  AS: ".-...",
  BK: "-...-.-",
};

/** One keyed element: key down (`on`) or up for `ms` milliseconds. */
export type KeyElement = { on: boolean; ms: number };

export const MIN_WPM = 5;
export const MAX_WPM = 60;

export const ditMs = (wpm: number) => 1200 / wpm;

/** Characters (or prosigns) -> morse pattern strings; null marks a word gap. */
const tokenize = (text: string): (string | null)[] => {
  const tokens: (string | null)[] = [];
  const upper = text.toUpperCase();
  let i = 0;
  while (i < upper.length) {
    const ch = upper[i];
    if (ch === "<") {
      const end = upper.indexOf(">", i);
      if (end > i) {
        const prosign = PROSIGNS[upper.slice(i + 1, end)];
        if (prosign) tokens.push(prosign);
        i = end + 1;
        continue;
      }
    }
    if (/\s/.test(ch)) {
      if (tokens.length > 0 && tokens[tokens.length - 1] !== null) {
        tokens.push(null);
      }
    } else if (MORSE[ch]) {
      tokens.push(MORSE[ch]);
    }
    i += 1;
  }
  while (tokens.length > 0 && tokens[tokens.length - 1] === null) tokens.pop();
  return tokens;
};

/** Text -> alternating key-down/key-up elements using standard PARIS timing. */
export const textToElements = (text: string, wpm: number): KeyElement[] => {
  const dit = ditMs(wpm);
  const out: KeyElement[] = [];
  const gap = (units: number) => {
    const last = out[out.length - 1];
    if (last && !last.on) last.ms += units * dit;
    else out.push({ on: false, ms: units * dit });
  };
  let prevWasChar = false;
  for (const token of tokenize(text)) {
    if (token === null) {
      // Letter gaps are added lazily before the next char, so 7 is the full word gap.
      gap(7);
      prevWasChar = false;
      continue;
    }
    if (prevWasChar) gap(3);
    [...token].forEach((symbol, idx) => {
      if (idx > 0) gap(1);
      out.push({ on: true, ms: (symbol === "-" ? 3 : 1) * dit });
    });
    prevWasChar = true;
  }
  return out;
};

export const clampWpm = (wpm: number) =>
  Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(wpm)));

/**
 * Cut-number form of a report: 1 -> A, 2 -> U, 3 -> V, 7 -> B, 8 -> D, 9 -> N,
 * 0 -> T (599 -> 5NN, 579 -> 5BN). 4, 5 and 6 stay as digits.
 */
const CUT_NUMBERS: Record<string, string> = {
  "1": "A",
  "2": "U",
  "3": "V",
  "7": "B",
  "8": "D",
  "9": "N",
  "0": "T",
};
export const shortenRst = (rst: string): string =>
  rst.replace(/[1237890]/g, (d) => CUT_NUMBERS[d]);

/**
 * Replace {MYCALL}, {HISCALL}, {RST}, {RST-SHORT} placeholders. Names are
 * case-insensitive; unknown ones are dropped.
 */
export const expandMacro = (
  text: string,
  vars: Record<string, string>,
): string =>
  text.replace(
    /\{([A-Za-z][A-Za-z-]*)\}/g,
    (_m, name: string) => vars[name.toUpperCase()] ?? "",
  );

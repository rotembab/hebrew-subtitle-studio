const TIMING =
  /^((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})[ \t]+-->[ \t]+((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})([^\n]*)$/;

export function timestampSeconds(value) {
  const parts = value.replace(",", ".").split(":").map(Number);
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((n) => !Number.isFinite(n) || n < 0) ||
    parts.at(-1) >= 60 ||
    (parts.length === 3 && parts[1] >= 60)
  )
    throw new Error("Invalid subtitle timestamp.");
  return parts.reduce((sum, part) => sum * 60 + part, 0);
}

export function parseSubtitles(input) {
  if (typeof input !== "string" || !input.trim())
    throw new Error("Choose a non-empty SRT or VTT file.");
  if (input.includes("\uFFFD"))
    throw new Error(
      "This file has invalid text encoding. Save it as UTF-8 and try again.",
    );
  const source = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const format = /^WEBVTT(?:[ \t]|\n|$)/.test(source) ? "vtt" : "srt";
  const blocks = source.split(/\n[ \t]*\n/);
  const segments = [],
    cues = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (
      format === "vtt" &&
      /^(WEBVTT(?:[ \t]|$)|NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(lines[0])
    ) {
      segments.push({ raw: block });
      continue;
    }
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex < 0 || timingIndex > 1 || lines.length <= timingIndex + 1)
      throw new Error(
        `Cannot read subtitle block ${segments.length + 1}. Check its timestamps and blank lines.`,
      );
    if (format === "srt" && timingIndex === 1 && !/^\d+$/.test(lines[0]))
      throw new Error("SRT cue numbers must be numeric.");
    const match = lines[timingIndex].match(TIMING);
    const start = timestampSeconds(match[1]),
      end = timestampSeconds(match[2]);
    if (end <= start)
      throw new Error(`Subtitle ${cues.length + 1} ends before it starts.`);
    const text = lines.slice(timingIndex + 1).join("\n");
    if (text.includes("-->"))
      throw new Error(`Missing blank line near subtitle ${cues.length + 1}.`);
    const cue = {
      id: cues.length + 1,
      identifier: timingIndex ? lines[0] : null,
      timing: lines[timingIndex],
      start,
      end,
      text,
    };
    if (text.length > 2000)
      throw new Error(
        `Subtitle ${cue.id} is too long (maximum 2,000 characters per cue).`,
      );
    cues.push(cue);
    segments.push({ cueId: cue.id });
  }
  if (!cues.length)
    throw new Error("No subtitle cues found. Use an SRT or VTT file.");
  if (cues.length > 15000)
    throw new Error(
      "This file exceeds 15,000 subtitle cues. Split it into smaller files.",
    );
  return { format, cues, segments };
}

export const plainText = (text) =>
  text.replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "");
export const markupTokens = (text) => text.match(/<[^>]*>|\{[^}]*\}/g) ?? [];

export function wrapSubtitle(text, width = 42) {
  // Preserve intentional line breaks, dialogue turns, and markup boundaries.
  if (text.includes("\n") || markupTokens(text).length || text.length <= width)
    return text.trim();
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return text;
  let best = 1,
    score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(" "),
      right = words.slice(i).join(" ");
    const cost =
      Math.abs(left.length - right.length) +
      Math.max(0, left.length - width) * 10 +
      Math.max(0, right.length - width) * 10;
    if (cost < score) {
      best = i;
      score = cost;
    }
  }
  return words.slice(0, best).join(" ") + "\n" + words.slice(best).join(" ");
}

export function qualityWarnings(cue, text, width = 42) {
  const warnings = [];
  const plain = plainText(text);
  // Flag a few concrete literal-rendering risks; never auto-replace dialogue.
  const idiomRisks = [
    [/\bbreak a leg\b/i, /רגל/],
    [/\bbark(?:ing)? up the wrong tree\b/i, /עץ/],
    [/\bspill(?:ing|ed)? the beans\b/i, /שעועית/],
    [/\bunder (?:your|my|his|her|their) skin\b/i, /עור/],
    [/\bbutterflies in (?:my|your|her|his) stomach\b/i, /חרקים/],
  ];
  if (
    idiomRisks.some(
      ([english, hebrew]) => english.test(cue.text) && hebrew.test(plain),
    )
  )
    warnings.push(
      "This may be a literal rendering of an English idiom. Check the meaning in context.",
    );
  if (!/[\u0590-\u05FF]/.test(plain))
    warnings.push(
      "No Hebrew text; check whether this name or label should be transliterated.",
    );
  if (plain.split("\n").some((line) => [...line].length > width))
    warnings.push(`A line exceeds ${width} characters.`);
  if (plain.split("\n").length > 2)
    warnings.push("More than two subtitle lines.");
  if ([...plain.replace(/\s/g, "")].length / (cue.end - cue.start) > 20)
    warnings.push("Reading speed is high; consider shortening the wording.");
  if (
    JSON.stringify(markupTokens(cue.text)) !==
    JSON.stringify(markupTokens(text))
  )
    warnings.push("Formatting tags differ from the original.");
  return warnings;
}

export function serializeSubtitles(document, translations) {
  const map = new Map(translations.map((row) => [row.id, row.text]));
  const bodies = new Map(
    document.cues.map((cue) => {
      const text = map.get(cue.id);
      if (typeof text !== "string" || !text.trim())
        throw new Error(
          `Subtitle ${cue.id} has no translation. Translate or edit all cues before exporting.`,
        );
      if (/\n\s*\n|-->|\u0000/.test(text))
        throw new Error(
          `Subtitle ${cue.id} contains a blank separator or timing marker. Remove it before exporting.`,
        );
      return [
        cue.id,
        [cue.identifier, cue.timing, text.trim()]
          .filter((value) => value !== null)
          .join("\n"),
      ];
    }),
  );
  const text =
    document.segments
      .map((segment) => segment.raw ?? bodies.get(segment.cueId))
      .join("\n\n") + "\n";
  return document.format === "srt"
    ? "\uFEFF" + text.replace(/\n/g, "\r\n")
    : text;
}

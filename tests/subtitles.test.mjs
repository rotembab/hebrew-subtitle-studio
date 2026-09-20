import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSubtitles,
  serializeSubtitles,
  wrapSubtitle,
  qualityWarnings,
  removeSpeakerLabels,
} from "../lib/subtitles.mjs";
const srt =
  "\uFEFF1\r\n00:00:01,000 --> 00:00:03,000\r\n<i>Hello.</i>\r\n\r\n2\r\n00:00:02,900 --> 00:00:05,000\r\nGoodbye.\r\n";
test("SRT keeps overlap, IDs, tags and timing during UTF-8 Hebrew export", () => {
  const doc = parseSubtitles(srt);
  const result = serializeSubtitles(doc, [
    { id: 1, text: "<i>שלום.</i>" },
    { id: 2, text: "להתראות." },
  ]);
  const back = parseSubtitles(result);
  assert.deepEqual(
    back.cues.map((c) => c.timing),
    doc.cues.map((c) => c.timing),
  );
  assert.equal(back.cues[0].text, "<i>שלום.</i>");
  assert.equal(result[0], "\uFEFF");
});
test("VTT retains header, NOTE, STYLE, IDs and cue position settings", () => {
  const doc = parseSubtitles(
    "WEBVTT - example\n\nNOTE author\nKeep metadata.\n\nSTYLE\n::cue { color: white; }\n\nintro\n00:01.000 --> 00:03.000 align:start position:10%\n<v Maya>Hello.</v>\n",
  );
  const result = serializeSubtitles(doc, [
    { id: 1, text: "<v Maya>שלום.</v>" },
  ]);
  assert.match(result, /NOTE author\nKeep metadata/);
  assert.match(result, /STYLE\n::cue/);
  assert.match(
    result,
    /intro\n00:01.000 --> 00:03.000 align:start position:10%/,
  );
  assert.equal(parseSubtitles(result).format, "vtt");
});
for (const [name, value] of Object.entries({
  empty: "",
  invalid: "random text",
  invalidTime: "1\n00:70:01,000 --> 00:70:03,000\nHello",
  backwards: "1\n00:00:03,000 --> 00:00:01,000\nHello",
  missingSeparator:
    "1\n00:00:01,000 --> 00:00:03,000\nHello\n2\n00:00:04,000 --> 00:00:05,000\nBye",
  badEncoding: "1\n00:00:01,000 --> 00:00:03,000\n\uFFFD",
})) {
  test(`reject malformed file: ${name}`, () =>
    assert.throws(() => parseSubtitles(value)));
}
test("export refuses incomplete translations and embedded cue separators", () => {
  const doc = parseSubtitles(srt);
  assert.throws(
    () => serializeSubtitles(doc, [{ id: 1, text: "שלום" }]),
    /no translation/,
  );
  assert.throws(
    () =>
      serializeSubtitles(doc, [
        { id: 1, text: "שלום\n\nחדש" },
        { id: 2, text: "שלום" },
      ]),
    /blank separator/,
  );
});
test("wrapping does not corrupt speaker breaks or tags and loses no words", () => {
  assert.equal(wrapSubtitle("- שלום\n- היי"), "- שלום\n- היי");
  assert.equal(wrapSubtitle("<i>שלום חברים</i>", 4), "<i>שלום חברים</i>");
  const long = "זו שורה ארוכה מאוד שצריכה להתחלק לשתי שורות בלי לאבד אף מילה";
  assert.equal(wrapSubtitle(long).replace("\n", " "), long);
  assert.equal(wrapSubtitle(long).split("\n").length, 2);
});
test("speaker label removal preserves spoken names, dashes, tags and dialogue colons", () => {
  assert.equal(
    removeSpeakerLabels("אחות: שברת את הרגל, מאיה.", ["אחות"]),
    "שברת את הרגל, מאיה.",
  );
  assert.equal(
    removeSpeakerLabels("- <b>מאיה:</b> אתה בא, טום?\n- טום: <i>כן.</i>", [
      "מאיה",
      "טום",
    ]),
    "- <b></b>אתה בא, טום?\n- <i>כן.</i>",
  );
  assert.equal(
    removeSpeakerLabels("מאיה: תזכורת: להתקשר לטום.", ["מאיה"]),
    "תזכורת: להתקשר לטום.",
  );
  assert.equal(
    removeSpeakerLabels("תזכורת: להתקשר לטום.", ["מאיה"]),
    "תזכורת: להתקשר לטום.",
  );
  assert.equal(removeSpeakerLabels("עכשיו 12:30.", []), "עכשיו 12:30.");
  assert.equal(removeSpeakerLabels("ד״ר א.: שלום.", ["ד״ר א."]), "שלום.");
});
test("QA flags untranslated text, fast reading and changed tags", () => {
  const cue = parseSubtitles(srt).cues[0];
  assert(qualityWarnings(cue, "hello").some((w) => w.includes("No Hebrew")));
  assert(qualityWarnings(cue, "שלום").some((w) => w.includes("Formatting")));
  assert(
    qualityWarnings({ ...cue, end: 1.1 }, "<i>שלום חברים</i>").some((w) =>
      w.includes("Reading speed"),
    ),
  );
});
test("idiom checks flag a literal rendering without changing a valid translation", () => {
  const cue = { id: 1, text: "Break a leg!", start: 0, end: 4 };
  assert(qualityWarnings(cue, "שבור רגל!").some((w) => w.includes("idiom")));
  assert.deepEqual(qualityWarnings(cue, "בהצלחה!"), []);
  assert.deepEqual(
    qualityWarnings({ ...cue, text: "I broke my leg." }, "שברתי את הרגל."),
    [],
  );
});
test("meaning checks flag profession errors, wrong idioms and softened explicit dialogue", () => {
  const check = (english, hebrew) =>
    qualityWarnings({ text: english, start: 0, end: 10 }, hebrew);
  assert(
    check("She works as an architect.", "היא עובדת כאדריכלות.").some((w) =>
      w.includes("Profession mismatch"),
    ),
  );
  assert.deepEqual(
    check("She works as an architect.", "היא עובדת כאדריכלית."),
    [],
  );
  assert.deepEqual(
    check("She studied architecture.", "היא למדה אדריכלות."),
    [],
  );
  assert(
    check("He screwed everything up.", "הוא חילל הכול.").some((w) =>
      w.includes("Meaning mismatch"),
    ),
  );
  assert.deepEqual(check("He screwed everything up.", "הוא דפק הכול."), []);
  assert.deepEqual(
    check("He desecrated the shrine.", "הוא חילל את המקדש."),
    [],
  );
  assert(
    check("They had sex.", "הם התענגו.").some((w) =>
      w.includes("explicit action"),
    ),
  );
  assert.deepEqual(check("They had sex.", "הם עשו סקס."), []);
  assert.deepEqual(check("Enjoy yourselves.", "תתענגו."), []);
  assert(
    check("She was making a name for herself.", "היא התחילה לצבור שם.").some(
      (w) => w.includes("collocation"),
    ),
  );
});

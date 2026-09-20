import test from "node:test";
import assert from "node:assert/strict";
import { parseSubtitles } from "../lib/subtitles.mjs";
import {
  translateDocument,
  validateTranslation,
  ensureLocalModel,
} from "../lib/translator.mjs";
const doc = parseSubtitles(
  "1\n00:00:01,000 --> 00:00:04,000\nBreak a leg!\n\n2\n00:00:05,000 --> 00:00:08,000\nThanks!",
);
const row = (id, text = "בהצלחה!") => ({
  id,
  text,
  note: "",
  needsReview: false,
});
const reply = (rows) => ({ translations: rows });
function mock(replies) {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    if (url.endsWith("/api/tags"))
      return Response.json({ models: [{ name: "test:local" }] });
    if (url.endsWith("/api/show"))
      return Response.json({ model_info: { "general.architecture": "test" } });
    const body = JSON.parse(options.body);
    calls.push(body);
    const next = replies.shift();
    if (next === "limit")
      return Response.json({
        done_reason: "length",
        message: { content: "{" },
      });
    return Response.json({
      message: { content: JSON.stringify(next) },
      done_reason: "stop",
    });
  };
  return { fetcher, calls };
}
test("translator supplies neighbors and previous Hebrew while preserving cue alignment", async () => {
  const { fetcher, calls } = mock([reply([row(1)]), reply([row(2, "תודה!")])]);
  const result = await translateDocument(
    doc,
    { model: "test:local", review: false, batchSize: 1 },
    () => {},
    undefined,
    fetcher,
  );
  assert.deepEqual(
    result.map((r) => r.id),
    [1, 2],
  );
  assert.equal(
    JSON.parse(calls[0].messages[1].content).followingDialogueForContextOnly[0]
      .english,
    "Thanks!",
  );
  assert.equal(
    JSON.parse(calls[1].messages[1].content).previousDialogue[0].hebrew,
    "בהצלחה!",
  );
  assert.equal(calls[0].think, false);
  assert.equal(calls[0].stream, false);
});
test("an output limit splits the batch without losing or duplicating cues", async () => {
  const { fetcher, calls } = mock([
    "limit",
    reply([row(1)]),
    reply([row(2, "תודה!")]),
  ]);
  const result = await translateDocument(
    doc,
    { model: "test:local", review: false },
    () => {},
    undefined,
    fetcher,
  );
  assert.deepEqual(
    result.map((r) => r.id),
    [1, 2],
  );
  assert.deepEqual(
    calls.map((call) => JSON.parse(call.messages[1].content).translate.length),
    [2, 1, 1],
  );
});
test("second pass can correct a first-pass mistranslation", async () => {
  const { fetcher, calls } = mock([
    reply([row(1, "שבור רגל!"), row(2, "תודה!")]),
    reply([row(1), row(2, "תודה!")]),
  ]);
  const result = await translateDocument(
    doc,
    { model: "test:local" },
    () => {},
    undefined,
    fetcher,
  );
  assert.equal(result[0].text, "בהצלחה!");
  assert.equal(calls.length, 2);
  const review = JSON.parse(calls[1].messages.at(-1).content);
  assert.equal(review.automaticChecks[0].id, 1);
  assert(review.automaticChecks[0].warnings.some((w) => w.includes("idiom")));
});
test("missing or reordered cues cause a retry, never silently corrupt the file", async () => {
  const { fetcher, calls } = mock([reply([row(2)]), reply([row(1), row(2)])]);
  const result = await translateDocument(
    doc,
    { model: "test:local", review: false },
    () => {},
    undefined,
    fetcher,
  );
  assert.equal(result.length, 2);
  assert.equal(calls.length, 2);
  assert.throws(
    () => validateTranslation(reply([row(2), row(1)]), doc.cues),
    /order/,
  );
});
test("invalid second pass retains first pass and explicitly requests review", async () => {
  const { fetcher } = mock([reply([row(1), row(2)]), reply([])]);
  const result = await translateDocument(
    doc,
    { model: "test:local" },
    () => {},
    undefined,
    fetcher,
  );
  assert(
    result.every(
      (r) =>
        r.needsReview && r.warnings.some((w) => w.includes("review failed")),
    ),
  );
});
test("resume preserves completed edits and sends only the remaining cues", async () => {
  const { fetcher, calls } = mock([reply([row(2, "תודה רבה!")])]);
  const result = await translateDocument(
    doc,
    { model: "test:local", review: false, completed: [row(1, "המון הצלחה!")] },
    () => {},
    undefined,
    fetcher,
  );
  assert.equal(result[0].text, "המון הצלחה!");
  assert.equal(JSON.parse(calls[0].messages[1].content).translate[0].id, 2);
});
test("cancel prevents further inference", async () => {
  const { fetcher, calls } = mock([]);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    translateDocument(
      doc,
      { model: "test:local" },
      () => {},
      abort.signal,
      fetcher,
    ),
    { name: "AbortError" },
  );
  assert.equal(calls.length, 0);
});
test("manual edits after an untranslated gap survive translation", async () => {
  const { fetcher, calls } = mock([reply([row(1)])]);
  const result = await translateDocument(
    doc,
    { model: "test:local", review: false, completed: [row(2, "תודה רבה!")] },
    () => {},
    undefined,
    fetcher,
  );
  assert.equal(result[1].text, "תודה רבה!");
  assert.deepEqual(
    JSON.parse(calls[0].messages[1].content).translate.map((c) => c.id),
    [1],
  );
});
test("cloud models and remote aliases are rejected", async () => {
  await assert.rejects(ensureLocalModel("qwen:cloud"), /Cloud/);
  const fetcher = async (url) =>
    Response.json(
      url.endsWith("/api/tags")
        ? { models: [{ name: "remote:latest" }] }
        : { remote_host: "https://ollama.com", remote_model: "other" },
    );
  await assert.rejects(
    ensureLocalModel("remote:latest", fetcher),
    /Cloud inference/,
  );
});
test("changed formatting and empty output fail validation", () => {
  const tagged = parseSubtitles(
    "1\n00:00:01,000 --> 00:00:03,000\n<i>Hello</i>",
  );
  assert.throws(
    () => validateTranslation(reply([row(1)]), tagged.cues),
    /formatting/,
  );
  assert.throws(
    () => validateTranslation(reply([row(1, "")]), [doc.cues[0]]),
    /invalid subtitle/,
  );
});
test("translation validation removes identified labels before review and export", () => {
  const cue = { id: 1, text: "Nurse: <i>Hello, Maya.</i>", start: 0, end: 4 };
  const result = validateTranslation(
    reply([{ ...row(1, "אחות: <i>שלום, מאיה.</i>"), speakerLabels: ["אחות"] }]),
    [cue],
  );
  assert.equal(result[0].text, "<i>שלום, מאיה.</i>");
  assert.deepEqual(result[0].warnings, []);
  assert.throws(
    () =>
      validateTranslation(
        reply([{ ...row(1, "<i>אחות:</i>"), speakerLabels: ["אחות"] }]),
        [cue],
      ),
    /no dialogue/,
  );
  assert.throws(
    () =>
      validateTranslation(
        reply([{ ...row(1, "<i>שלום.</i>"), speakerLabels: "אחות" }]),
        [cue],
      ),
    /invalid speaker labels/,
  );
});

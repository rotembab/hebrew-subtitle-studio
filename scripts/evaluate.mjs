import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseSubtitles, serializeSubtitles } from "../lib/subtitles.mjs";
import { translateDocument, DEFAULT_MODEL } from "../lib/translator.mjs";
const fixture = process.argv[3]
  ? resolve(process.argv[3])
  : new URL("../examples/idioms.srt", import.meta.url);
const fixtureName = process.argv[3]
  ? basename(process.argv[3]).replace(/\.(srt|vtt)$/i, "")
  : "idioms";
const source = await readFile(fixture, "utf8");
const doc = parseSubtitles(source);
const started = Date.now();
const model = process.argv[2] || DEFAULT_MODEL;
const translations = await translateDocument(
  doc,
  {
    model,
    context:
      "Maya is female. Daniel and Tom are male. The nurse is female. Use casual, contemporary Hebrew.",
    review: true,
  },
  (event) => {
    if (event.type === "progress")
      console.log(`${event.phase}: ${event.from}-${event.to}`);
  },
);
await mkdir(new URL("../output/", import.meta.url), { recursive: true });
await writeFile(
  new URL(`../output/${fixtureName}.he.${doc.format}`, import.meta.url),
  serializeSubtitles(doc, translations),
  "utf8",
);
await writeFile(
  new URL(
    `../output/evaluation-${fixtureName}-${model.replace(/[^a-z0-9.-]/gi, "-")}.json`,
    import.meta.url,
  ),
  JSON.stringify(
    { model, elapsedSeconds: (Date.now() - started) / 1000, translations },
    null,
    2,
  ),
  "utf8",
);
for (const cue of doc.cues) {
  const row = translations.find((r) => r.id === cue.id);
  console.log(
    `${cue.id}. ${cue.text}\n${row.text}\n${row.note}${row.needsReview ? " [REVIEW]" : ""}\n`,
  );
}
console.log(
  `Completed in ${Math.round((Date.now() - started) / 1000)}s. Review the evaluation file in output/ for linguistic quality; this is not a quality score.`,
);

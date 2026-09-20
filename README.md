# Hebrew Subtitle Studio

A free, local English-to-Hebrew subtitle translator. Import an SRT or WebVTT file, translate with a model running in Ollama, review the English and Hebrew side by side, and export the Hebrew file with its original timing.

The translation instructions focus on **meaning and natural Hebrew**: context-sensitive idioms, tone, slang, gender agreement, names, and dialogue spread across subtitle cues. For example, “break a leg” before an audition should become “בהצלחה”, while a literal injury stays an injury.

The model is encouraged to use natural spoken Hebrew, reshape sentences and omit redundant words when context already conveys them. It should preserve the intended action, important facts and tone, including explicit wording, without copying English sentence structure.

## Start

Requires [Node.js 22+](https://nodejs.org/) and [Ollama](https://ollama.com/download). No npm dependencies or API key.

Install the default local model once:

```sh
ollama pull gemma4:12b
```

The model download is approximately 7.6 GB. A capable GPU is strongly recommended; CPU inference can be slow. Other installed local Ollama models can be selected in the app, but their Hebrew ability and structured-output support vary. Cloud models are excluded. Extended thinking is disabled to keep batch times practical; translation still uses an intended-meaning paraphrase and optional second-pass review. A full film can take substantial time.

**Windows:** double-click `Start.cmd`. It starts the local app and opens your browser.

**macOS / Linux / terminal:** start Ollama, then run:

```sh
node server.mjs
```

Open **http://127.0.0.1:4318**. An alternative port can be set with the `PORT` environment variable when running the server directly.

## Use

1. Choose an English `.srt` or `.vtt` file (UTF-8, at most 3 MB), or load the included fictional example.
2. Add any known character genders, setting, name spellings and terminology. For example: `Maya is female. Daniel is male. Keep Hawkins as הוקינס.`
3. Select a local model and click **Translate to Hebrew**. Second-pass review is enabled by default.
4. Check **Needs review** and edit any Hebrew line. Mark a cue as reviewed after checking it.
5. Export the Hebrew subtitle file. Export is available only when every cue has text.

**Stop** cancels the current request and keeps completed batches. **Continue translation** resumes with those results and preserves manual edits. **Save project** downloads a JSON file containing the source, translations and settings; **Open saved project** restores it. Project files are private working files and are ignored by Git.

## How it works

- Translates sequential batches of up to 12 cues, with four preceding and four following cues for context, plus previous Hebrew translations and your character/terminology notes.
- Asks for a short intended-meaning paraphrase before the Hebrew text to help separate an idiom's meaning from its wording.
- Keeps original speaker labels as context, asks the model to identify them separately, and removes those prefixes from Hebrew dialogue while preserving names spoken within a line, dialogue dashes and formatting tags.
- Requests structured JSON from Ollama and validates cue IDs, order, non-empty text and formatting tags. Invalid batches are retried once; batches that hit the output limit are split into smaller ones automatically.
- Optionally reviews each draft against the source to correct idioms, meaning and phrasing. Automatic warnings are passed to the reviewer to target detected meaning errors, unnatural collocations, profession/field confusion and softened explicit dialogue. If that review fails, the draft remains available with an explicit warning.
- Preserves original timestamps, cue identifiers, overlapping cues, WebVTT metadata and positioning. No retiming, merging or deletion of cues.
- Wraps eligible plain-text translations into two lines and flags excessive length, reading speed, missing Hebrew or ambiguity. A small set of additional heuristics flags potentially literal idiom renderings. It never truncates dialogue to fit or replaces an idiom automatically.
- Uses logical right-to-left Hebrew Unicode. SRT export is UTF-8 with BOM and CRLF; VTT export is UTF-8.

## Quality and limits

This is assisted translation, not guaranteed professional localization. A local model can miss jokes, choose an awkward expression, get gender wrong, or introduce errors in its review pass. Review flags are heuristic/model suggestions, not a guarantee that unflagged lines are correct. Character notes help when the subtitle file alone cannot resolve gender or identity. Context is a rolling window, not full-film understanding; maintain important recurring terminology in the notes.

The app translates text subtitles only. It does not transcribe audio, OCR image subtitles, or support ASS/SSA styling. It preserves timing rather than repairing badly timed source files. Short, very dense cues may still require manual shortening. Non-UTF-8 subtitle files must be converted before import.

## Privacy

The app server listens only on `127.0.0.1`. Inference requests go only to Ollama at `127.0.0.1:11434`; cloud model names and remote model aliases are rejected. The app has no analytics, API key field, CDN fonts, or external translation fallback. Internet access is needed to install software and download models, but not for translation after setup.

Subtitles and translations remain in browser/server memory until you explicitly download a project or subtitle file. The server does not write your uploaded subtitles to disk. Reloading the page discards unsaved work. Keep private files outside the repository; generated output, logs and saved projects are ignored by Git.

## Development and checks

```sh
node --test
node scripts/evaluate.mjs
node scripts/evaluate.mjs gemma4:12b examples/context-check.vtt
```

The unit/integration suite uses mocked inference and requires no model. The separate live evaluation uses the installed model, translates fictional idiom-heavy dialogue, and writes ignored files under `output/` for human review. It reports elapsed time, not a linguistic accuracy score.

Core code is in `lib/subtitles.mjs` (parsing, preservation, export and readability checks), `lib/translator.mjs` (translation instructions, local inference and review), `server.mjs` (local HTTP server), and `public/` (browser editor). Runtime dependencies are Node built-ins only.

Model weights are downloaded separately and are not included in this repository. Their licenses apply independently. Integration follows Ollama's [chat API](https://docs.ollama.com/api/chat) and [structured-output documentation](https://docs.ollama.com/capabilities/structured-outputs). Default model details: [Gemma 4 12B](https://ollama.com/library/gemma4:12b).

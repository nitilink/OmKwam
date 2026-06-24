# OmKwam 0.34c

OmKwam 0.34c is a privacy-first workspace for testimony transcription. It is designed for Thai testimony workflows where users need to record or import audio, transcribe it, review uncertain words, and prepare a concise testimony summary.

OmKwam is part of the NitiLink project.

## Public Source Note

This public GitHub package redacts proprietary prompt templates used for transcription, testimony summarization, and summary review. The UI, client-side privacy model, storage behavior, and static app structure are included for transparency. The redacted prompt placeholders are not intended for production use.

## Key Features

- Record audio from the microphone in the browser.
- Upload audio files directly from the user's computer.
- Transcribe testimony with Gemini using the user's own API key.
- Highlight unclear or contextually suspicious words for review.
- Summarize testimony from the transcript with built-in testimony summary rules, limited case context, and a configurable dictionary.
- Copy or download transcript and summary text.
- Run as a static web app with no developer-operated backend.

## Privacy Model

- OmKwam does not include a developer-operated backend, database, or proxy.
- Audio, transcript text, summary text, and Gemini API keys are not sent to the developer.
- Requests are sent from the user's browser directly to Gemini API with the API key entered by the user.
- Settings are stored only in the user's browser when the user enables local persistence.
- Users are responsible for evaluating Gemini's terms, data handling, risks, and generated outputs before use.

## Local Run

On this machine:

```powershell
.\start-local.ps1
```

If Node.js is available:

```powershell
node .\scripts\serve.mjs --port 5173
```

Then open:

```text
http://127.0.0.1:5173/
```

## Build

```bash
node scripts/build.mjs
```

The generated `dist/` folder can be deployed to a static host such as GitHub Pages, Cloudflare Pages, Netlify, Vercel static hosting, or an ordinary web server.

## Configuration

Users need their own Gemini API key. The app can optionally store the key in the user's browser localStorage when the user enables key persistence.

Stored user-side settings are scoped to the current browser origin, for example `https://www.nitilink.com`. They are not sent to the developer:

- API key: `omkwam.byok.apiKey`, stored only when the user enables key persistence.
- Model: `omkwam.byok.model.2026-06-21-v2`.
- Dictionary: `omkwam.byok.dictionary.2026-06-24-v9`.
- Case Info: `omkwam.byok.caseInfo.2026-06-24-v1`.
- Extra instructions: `omkwam.byok.instructions.2026-06-21-v4`.

The dictionary panel supports:

- term replacement rules.

The Case Info panel stores limited case context: preliminary facts, case documents, and proper names of related people, objects, or places. It is used only to help spelling and issue grouping; testimony summaries must still be based on witness answers in the transcript.

## Tutorial

Video tutorial content will be added after publication.

## Source Transparency

This repository is published for transparency. Proprietary prompt templates are redacted from the public source package.

## Contact

Developer: Kosarit "slowkid" Nasomjai

Email: nitilink.app@gmail.com

## License

License information will be added before public release.

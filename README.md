# OmKwam 0.34e

OmKwam 0.34e is a privacy-first experimental workspace for Thai testimony transcription. It can record or import audio, transcribe it with Gemini using the user's own API key, help review uncertain words, and draft a concise testimony summary for human review.

OmKwam is part of the NitiLink project.

Last updated: 26 Jun 2026, 02:47 ICT.

## Experimental Notice

OmKwam is a personal experimental project by the developer to study the feasibility of using AI to assist with audio transcription and testimony-summary drafting. It is not a system of any agency or organization, and it cannot replace human review. Users must inspect, edit, and take responsibility for any use of the generated output.

## Key Features

- Record audio from the microphone in the browser.
- Upload audio files directly from the user's computer.
- Play back and save the latest audio locally.
- Transcribe testimony with Gemini using the user's own API key.
- Highlight unclear or contextually suspicious words for review.
- Draft testimony summaries from transcript text with built-in summary rules, limited case context, and a configurable dictionary.
- Copy or download transcript and summary text.
- Run as a static web app with no developer-operated backend.

## Privacy Model

- OmKwam does not include a developer-operated backend, database, or proxy.
- Audio, transcript text, summary text, and Gemini API keys are not sent to the developer.
- Requests are sent from the user's browser directly to Gemini API with the API key entered by the user.
- Settings are stored only in the user's browser when the user enables local persistence.
- Users are responsible for evaluating Gemini's terms, data handling, risks, and generated outputs before use.

## Local Run

Install Node.js, then run:

```powershell
node .\scripts\serve.mjs --port 5173
```

Then open:

```text
http://127.0.0.1:5173/
```

This repository currently has no build step. The app is served directly from `index.html` and `src/`.

## Static Deploy

For a static host such as GitHub Pages, Cloudflare Pages, Netlify, Vercel static hosting, or an ordinary web server, deploy:

- `index.html`
- `src/`

The `scripts/serve.mjs` file is only a small local development server and is not required by static hosting.

## Configuration

Users need their own Gemini API key. The app can optionally store the key in the user's browser localStorage when the user enables key persistence.

Stored user-side settings are scoped to the current browser origin, for example `https://www.nitilink.com`. They are not sent to the developer:

- API key: `omkwam.byok.apiKey`, stored only when the user enables key persistence.
- Model: `omkwam.byok.model.2026-06-21-v2`.
- Dictionary: `omkwam.byok.dictionary.current`.
- Case Info: `omkwam.byok.caseInfo.2026-06-24-v1`.
- Extra instructions: `omkwam.byok.instructions.2026-06-21-v4`.

The dictionary panel supports term replacement rules.

The Case Info panel stores limited case context: preliminary facts, case documents, and proper names of related people, objects, or places. It is used only to help spelling and issue grouping; testimony summaries must still be based on witness answers in the transcript.

## Public Source Notes

The working static frontend contains the prompt text required for browser-side Gemini requests. If the app is deployed as a static frontend, users can inspect that prompt text in the served JavaScript.

For public GitHub distribution, sensitive private prompt text is redacted from this public-source package. This package is for transparency and review, not for direct functional deployment unless the private prompt text is restored by the maintainer.

## Tutorial

Video tutorial content will be added after publication.

## Contact

Developer: NitiLink

Email: [redacted in public source package]

## Use Notice

Free for personal and public-interest use. Commercial use is prohibited.

## License

License information will be added before public release.


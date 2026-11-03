# Landscaping quote builder v1

Public entry point: https://leveragedsystems.com.au/tools/quote-builder/

This is an unlinked, password-free tool. Anyone with its address can open it. The homepage and sitemap do not link to it. `noindex` headers and robots exclusions discourage search indexing; they do not restrict access.

## Using it

1. Open the page online once. Enter the customer, address and your business details.
2. Add named areas: turf, mulch / garden beds, planting, cleanup or concreting. Capture notes, photographs, audio and sketches. Enter measured dimensions separately. Sketches are visual notes, not scaled drawings.
3. Save a sketch to attach it to an area. Select up to six photographs / saved sketches in total for a scope request. Raw recordings stay on the device unless you select Transcribe. Original audio is retained after transcription.
4. Prepare scope online, or write scope and exclusions yourself. AI proposals remain separate until you apply them. Resolve outstanding questions and review all proposed quantities.
5. Review the sample AUD catalogue, add items and confirm quantities and rates. GST is off initially; select 10% if applicable. Starting prices are examples, not researched landscaping rates.
6. Check the quote and download the PDF online. Missing confirmations or required details produce a clearly marked draft. The PDF service independently recalculates every amount.

Drafts and captures are stored in IndexedDB in the current browser, on the current device. They are not synchronised or backed up to a server. Export all visits regularly using Visit options, and keep the JSON file somewhere safe. A backup includes customer details and media. Import validates the complete file before any records are written and asks before replacing matching visits. Clearing browser data removes local records. Private browsing can discard records when closed.

After the app shell is cached successfully, local capture, pricing and preview can work offline. AI requests can be queued locally and are sent only when explicitly run after reconnecting. PDF generation needs an internet connection. Microphone capture depends on browser permission and support; uploading audio or typing notes remains available.

## What the harness does

`api/quote-builder.js` routes configuration, drafting, transcription, calculation and PDF requests. `lib/quote-builder/harness.mjs` validates and bounds input, removes business/customer fields and raw audio from model context, chooses the configured model, permits only `get_services` and `prepare_scope`, validates proposed service IDs / area IDs / quantities, limits execution to four model steps, and returns a trace. The model proposes work; it cannot approve quantities, change rates, send email or run arbitrary tools. `tools/quote-builder/domain.mjs` calculates prices with integer cents and exact rounding. The PDF receives only normalized customer-facing quote fields.

No visit database exists on the server. Selected data is processed by the API / model providers when requested. Do not add raw request bodies, recordings, customer details or tokens to application logs.

## AI connection status

The real Gateway text request made during implementation returned `403`: Vercel requires a valid card on file before servicing AI Gateway requests. The adapter is implemented, but live drafting, image interpretation and transcription cannot be signed off until the account owner completes Vercel billing verification. The application shows the actual service error and retains manual editing. No card was added or terms accepted during this build.

The deployed function uses Vercel OIDC automatically. An `AI_GATEWAY_API_KEY` can be configured instead. Defaults:

- `QUOTE_AI_MODEL=anthropic/claude-haiku-4.5`
- `QUOTE_TRANSCRIPTION_MODEL=fish-audio/transcribe-1`

Optional `ANTHROPIC_API_KEY` enables direct Anthropic scope drafting (default `claude-haiku-4-5`); transcription still needs Gateway. Set `QUOTE_AI_MODEL` to an Anthropic model ID when using the direct adapter. Keep keys exclusively in server environment variables.

Before enabling billable AI, set an appropriate Gateway spend limit in the Vercel account. Input sizes and the four-step loop are bounded; the in-memory IP throttle is per function instance and is not a global spending cap. This public endpoint has no user authentication, as requested. V1 is intended for a small pilot. Global quotas / authentication can be added if access needs to expand.

Limits: 20 areas per scope request, six selected images / sketches, 300 KB per processed image, 2.5 MB per transcription recording, 24,000 text characters of model context, 4 MB API request, 60 quote items, quantities with at most two decimal places. Large original audio can stay in the local visit without being sent.

## Development and verification

Requires Node 24. Run `npm ci`, then `npm run quote:start`. Open http://127.0.0.1:4173/tools/quote-builder/. The local server has no keys by default; manual workflow and PDF work without them. For a private local environment file, use `node --env-file=.env.gateway.local scripts/quote-builder-dev.mjs`; never commit or deploy that file. Expired OIDC tokens need refreshing through Vercel CLI.

`npm test` runs both existing project tests and the quote-builder suite. `npm run quote:test` runs focused money, API, harness, storage and PDF tests. External model fixtures test harness behaviour only and do not constitute a live model test. PDF tests include actual embedded Inter glyph outlines because text extraction alone can miss blank rendered glyphs. The Inter asset is a static instance with two-byte glyph alignment; preserve this property if replacing fonts.

Vercel project `leveragedsystems` serves the existing domain. Preview the branch before production deployment. `.vercelignore` excludes internal business tools, tests, docs, local environment files and the development server. The service worker is scoped to `/tools/quote-builder/` and never intercepts API or homepage requests.

Manual release checks: mobile layout, edit/reload, independent visits, photo and audio retention, drawing and erasing, backup round-trip / bad-file rejection, offline capture, visible failed saves, catalogue edits, exact GST total, confirmation reset on edits, draft/final PDF and unchanged homepage. Complete a real text/image/transcription smoke test after billing verification; keep an actual phone microphone test as a separate device check.

Concreting uses entered length × width × slab thickness to propose concrete supply volume in m³. Its catalogue rate is a sample for supply only. Preparation, formwork, reinforcement, pump hire, placement, finishing, joints and removal are separate reviewed allowances; no structural design is inferred.

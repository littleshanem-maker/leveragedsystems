# Landscaping quote builder v1 — accepted build contract

Single-user phone-first app at /tools/quote-builder, unlinked and no password, preserving the live homepage. Match Archivo headings, Inter text, DM Mono labels, #FF5B14, #0A0A0A, #FFFFFF, #F7F7F7, square corners. Source user-approved chat plan and branded walkthrough. Prototype is illustrative only; implementation must be real.

## Owned files and interfaces

Frontend owns tools/quote-builder/index.html, app.css, app.js, storage.mjs, sw.js, manifest.webmanifest. The orchestrator owns domain.mjs, API, server harness, PDF, configuration and tests. Browser code may import domain.mjs.

Visit shape: {version:1,id,createdAt,updatedAt,customer:{name,address,email,phone},business:{name,email,phone,abn},areas:[{id,name,jobType,notes,length,width,depthMm,quantityConfirmed,access,materials,disposal,photos:[{id,name,type,dataUrl}],recordings:[{id,name,type,dataUrl,transcript}],sketch:{dataUrl}}],catalogue,quote:{reference,issueDate,validDays,scope,exclusions,items:[{id,serviceId,quantity,description,confirmed}],taxRateBps,scopeConfirmed,ratesConfirmed},activity:[]}.

Job types turf, mulch, planting, cleanup, concreting. All local drafts/media in IndexedDB. Provide export/import backup, saved/error status, multiple areas, device-only visits list, explicit deletion. Autosave on edits, preserve live audio on stop, photo resize, draw/erase/clear/save sketch. Microphone permission denial offers uploaded audio or typed notes. Transcription failure preserves original recording. Raw recordings stay local unless user selects Transcribe; photos/sketches sent only when user prepares scope. Page shell offline after first successful load; API calls never cached. Browser storage is not cloud backup. Clear sample data is always labelled.

GET /api/quote-builder => {version:1,catalogue,ai:{configured,model,transcriptionConfigured,transcriptionModel},limits:{maxAudioBytes,maxImageBytes,maxImages,maxInputChars}}.

POST /api/quote-builder JSON:
- {action:'draft',visit,catalogue} => {scope:string,exclusions:string,items:[{serviceId,quantity,description,areaId}],questions:string[],trace:[{event,detail}],model,usage}. Filter raw audio out of request; include notes/transcripts, measurements and bounded resized photos/sketches. Proposed items are unconfirmed; apply only after human review. Failed AI requests leave manual workflow usable and show actual error, never fake output.
- {action:'calculate',quote:quoteInput} => normalized calculated quote (see below).
- {action:'pdf',quote:quoteInput} => PDF bytes, application/pdf, Content-Disposition attachment.
- {action:'transcribe',audio:{dataUrl,type,name}} => {transcript,model,trace}.

quoteInput is {...visit.quote,customer:visit.customer,business:visit.business,catalogue:visit.catalogue}. Every line must reference catalogue serviceId; changing rate edits the catalogue. Server always recalculates, never trusts client totals. Prices integer AUD cents, quantity max two decimal places, GST basis points 0 or 1000. Items retain their areaId if available. Missing customer name, address, business name, scope, quantity confirmations, scope/rate approval or unresolved questions produce a draft, prominently marked in preview and PDF. Valid numeric input required even for draft export. Users may export a clearly marked draft. Final uses confirmed scope and rates. Final quote revisions always recalculate.

Exports from domain.mjs: DEFAULT_CATALOGUE; calculateQuote(input); deriveMeasurements(area) => {areaM2:number|null,volumeM3:number|null}; formatMoney(cents); createVisit(). calculateQuote returns normalized customer,business,reference,issueDate,validUntil,scope,exclusions,items:[{id,serviceId,name,description,unit,quantity,rateCents,lineTotalCents,confirmed}],subtotalCents,taxCents,totalCents,taxRateBps,warnings:string[],isDraft:boolean.

## Verification and delivery

Prove arithmetic and invalid data through domain tests; test API validation and tool loop with explicit fixtures (not live feature claims); real model, image and transcription checks when gateway available; browser desktop/mobile capture, persistence, backup/restore, scope, edits, pricing and PDF. Test dropped connection and explicit save errors; inspect generated PDF. No automatic email, payments, CRM, scaled CAD, multi-user data store or customer acceptance. No homepage edits, navigation links or sitemap entry. Add noindex headers and robots exclusions for the tool only. Preserve existing redirects and existing API contracts. Build committed feature branch; review independently; fix findings; deploy Vercel preview then production; keep source available in GitHub PR. Current production source eeb8e71. User explicitly authorized autonomous build, testing and deployment without intermediate approvals.

Concreting uses entered length × width × slab thickness to propose concrete supply volume in m³. Its catalogue rate is a sample for supply only. Preparation, formwork, reinforcement, pump hire, placement, finishing, joints and removal are separate reviewed allowances; no structural design is inferred.

## Browser harness settings (subsequent user request)

Provide a settings screen and immutable saved versions in this browser. Explicit user choice: browser-only first, saved profiles affect their requests only. Model routing chooses a supported scope model or a supported image model when selected images are included. Allow writing preferences, image/transcript context switches, drafting/transcription switches, 1–4 steps, 256–2200 output tokens and 5–22 second model-call deadlines. Enforce limits and supported models on the server. Keep catalogue/proposal validation, exact cents, human review and secret keys outside these editable settings. Settings activation affects the next request; in-progress requests retain a snapshot. Local validation must be labelled separately from a real paid AI test, and a failed live test must show the actual error. Saved versions can be loaded, restored, exported and imported; storage failures remain visible. Shared owner administration/login is future work and not represented as implemented.

## Actual instructions and run transparency (approved addition)

Show the exact system instructions built for the model, fixed rules, evidence request prefix and allowed tool definitions. The purpose/working brief is editable and is part of the actual system message; retain additional writing preferences. Show which rules remain fixed in code. Older saved profiles receive the default brief.

Record actual model attempts (success or failure), exact system instructions and initial evidence text, requested model, provider-reported model when available, settings snapshot, tool calls/results, validation checks, timing, usage, returned proposal or error. Retain up to20 records in this browser with export. Exclude raw media and contact fields; evidence text may contain site notes, so disclose local record/export privacy. Missing connection or billing must remain an error record and never be presented as a successful AI test. Show active-versus-edited instructions/settings locally and offer real paired sample runs using the same fictional evidence, stopping if baseline fails. Model variation means output differences alone do not prove causation.

# Outreach Desk

Outreach Desk is Shane's local, single-user acquisition console. Codex agents can prepare research and drafts through the role-scoped CLI. Shane reviews every message and sends it manually through Apple Mail. The application never sends email.

## Start in the foreground

Requirements: macOS, Node 24.15 or newer, and Apple Mail configured as the default email handler with the business account.

```sh
npm run outreach:start
```

Open `http://127.0.0.1:4317`. Run `npm run outreach:check` in another terminal to confirm the service and database are available. Stop the foreground process with Control-C.

The default database location is:

```text
~/Library/Application Support/Leveraged Systems/Outreach Desk/outreach.sqlite
```

Override it for testing with `OUTREACH_DATA_DIR=/absolute/path`. The server refuses hosts other than `127.0.0.1`; do not expose it with a tunnel or port-forward.

## Daily workflow

1. Open **Today** and process overdue work, due actions, and the approval queue.
2. Review the recipient, subject, body, problem angle, and evidence for every draft.
3. Approve or edit the draft, then choose **Open in Apple Mail**.
4. Send it yourself in Apple Mail.
5. Return to Outreach Desk and choose **Confirm sent**. Opening or abandoning Apple Mail never counts as sent.
6. Open the prospect before calling. Use the tailored **Cold call this prospect** guide, place the call yourself, then record the attempt outcome, exact language, and next action.
7. Use the verified public phone number for call follow-up when appropriate, then record replies, suitability calls, qualification evidence, recommendations, and next actions in the prospect workspace.

Copy controls are the fallback if a long `mailto:` handoff is refused or truncated. Copying also never records a send.

## Cold call guide

The prospect detail view prepares a human-only call guide from the stored decision-maker, problem hypothesis, and evidence. It contains:

- a tailored permission-based opener;
- the primary site-to-office problem question;
- the transition to a suitability call;
- a reminder not to diagnose or sell the Sprint on the cold call; and
- a copy control that does not place or record a call.

After the call, record one of the structured outcomes: no answer, voicemail, gatekeeper or wrong contact, callback requested, connected, suitability call booked, not interested/nurture, or do not contact. All outcomes except do-not-contact require an explicit next action and due date. The Scorecard reports cold-call attempts, connections, and suitability calls booked separately from completed suitability calls.

## Agent preparation

The CLI exposes read-only operations for shared work and role-scoped mutations for research, prospect, draft, and next-action preparation. Read a prospect before updating it so the mutation includes its current optimistic `version`:

```sh
npm run outreach:agent -- listProspects
npm run outreach:agent -- getProspect --json '{"prospectId":"…"}'
npm run outreach:agent -- today
npm run outreach:agent -- listDrafts
npm run outreach:agent -- scorecard
npm run outreach:agent -- createProspect --file /path/to/prospect.json --actor "Prospecting agent"
npm run outreach:agent -- updateProspect --json '{"prospectId":"…","expectedVersion":1,"patch":{"evidence":"Updated sourced evidence."}}'
```

`getProspect` returns the prospect plus its shared `actions`, `drafts`, and `events`. To link a new draft to a next action, copy the relevant `actions[].id` from that response into the draft's `actionId`:

```sh
npm run outreach:agent -- createDraft --json '{"prospectId":"…","actionId":"…","recipient":"…","subject":"…","body":"…","problemAngle":"…","evidenceBasis":"…"}'
```

It has no approval, sent-confirmation, reply, call, restore, or email-send operation. This is a cooperative workflow boundary: an agent or process with arbitrary access to Shane's macOS account is not OS-isolated from the local database.

## Persistent service

Review the installer before running it. Installation is an explicit user action:

```sh
internal/outreach-desk/scripts/install-launch-agent.sh install
```

Check with `npm run outreach:check`. Uninstall without deleting operating data:

```sh
internal/outreach-desk/scripts/install-launch-agent.sh uninstall
```

The installer preserves the database, backups, and owner-only logs. It moves the rendered LaunchAgent to a disabled file rather than deleting operating data.

## Backup and restore

Create a private manual backup:

```sh
npm run outreach:backup
```

You can provide an explicit destination as the final argument. The Data view downloads a portable JSON snapshot and restores a selected snapshot only after confirmation. Every restore validates the entire snapshot and writes a private pre-restore backup before changing live data.

Copy important backups off the Mac Mini. Verify FileVault is enabled in **System Settings → Privacy & Security → FileVault**; Outreach Desk uses owner-only permissions but does not add separate database encryption.

## Phone access checklist

- Use the existing phone remote-workstation application; Outreach Desk does not listen on the network.
- Confirm Today, prospect details, approval controls, Apple Mail handoff, sent confirmation, and outcome capture work through the actual phone remote session.
- Keep the Mac Mini browser and Apple Mail available inside that remote session.

## Verification and upgrades

```sh
npm test
npm run outreach:test
npm run outreach:verify-deploy
```

The Vercel isolation check requires Vercel CLI 54.17.2 or newer and uses `vercel deploy --dry --format=json`, which creates no deployment. The app detects an older CLI and stops with an upgrade instruction.

Before upgrading application code: export a snapshot, stop the service, update the checkout, run `npm test`, then restart. Database migrations run once on startup and preserve existing records.

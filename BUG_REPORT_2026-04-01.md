# LinkedIn Hyper-V Bug Report and Improvement Plan
Date: 2026-04-01  
Prepared by: Kanchi

## Scope
This document covers bugs observed from:
1. Inbox screenshot (`Unknown` participant, `0 messages` in selected thread)
2. Connections screenshot (`No connections found`)
3. Runtime behavior reported during server tests (message API says success, but account-side visibility is inconsistent)

---

## Bug 1: Inbox participant shown as `Unknown`
Severity: High  
Status: Fixed in code (pending deploy verification)

### Symptom
- Inbox list and selected conversation header show `Unknown` instead of real LinkedIn profile name.

### User Impact
- Users cannot identify whom they are chatting with.
- Trust in CRM/unified inbox quality is reduced.

### Technical Evidence
- Fallbacks to `Unknown` exist in parser and sync flow:
  - `worker/src/actions/readMessages.js` (name extraction fallback)
  - `worker/src/services/messageSyncService.js` (participant fallback)
  - `worker/src/index.js` (unified payload normalization fallback)

### Root Cause
- Worker cannot reliably extract full participant metadata from LinkedIn DOM in some sessions/layouts.
- When extraction fails, fallback placeholders are stored and surfaced in UI.

### Improvement Suggestion
1. Add metadata enrichment pass:
   - If participant name/profile URL is missing, open thread and fetch canonical profile link/name before persisting.
2. Store metadata quality flags:
   - `isMetadataIncomplete`, `source=dom_fallback/live_enriched`.
3. Retry strategy:
   - Retry metadata extraction up to N times before final fallback.

### Acceptance Test
- For a known thread, inbox should show real participant name and profile URL in at least 95% of refreshes.

---

## Bug 2: Conversation shows preview text but selected thread shows `0 messages`
Severity: High  
Status: Fixed in code (pending deploy verification)

### Symptom
- Left pane shows a recent preview (`You: Hi, test message...`) but right pane shows `0 messages`.

### User Impact
- Users think messages are lost.
- Reply workflow breaks because thread context is empty.

### Technical Evidence
- Thread route in worker (`/messages/thread`) currently reads DB only.
- If conversation ID is fallback/unknown or thread sync has not persisted messages, DB returns empty.

### Root Cause
- Mismatch between live inbox preview data and persisted thread data.
- No live fallback on thread read when DB has zero messages.

### Improvement Suggestion
1. Implement live fallback in `/messages/thread`:
   - If DB returns empty, call `readThread` (LinkedIn live) and return that data.
2. Normalize conversation ID mapping:
   - Ensure same canonical thread ID used for inbox item and thread storage.
3. Save-on-read strategy:
   - When live fallback fetches messages, upsert immediately to DB.

### Acceptance Test
- Selecting a conversation with preview text should always render non-empty thread if messages exist on LinkedIn.

---

## Bug 3: API reports send success, but recipient/account does not consistently see message
Severity: High  
Status: Fixed in code (pending deploy verification)

### Symptom
- `send-new` path returns success, but recipient-side message visibility is inconsistent.

### User Impact
- Automation reliability is questionable for production use.

### Technical Evidence
- `worker/src/actions/sendMessageNew.js` marks success after send-button click.
- No strict post-send verification step exists to confirm message bubble and thread persistence.

### Root Cause
- Success criteria is currently "click executed", not "delivery verified".
- LinkedIn UI race conditions or anti-automation behaviors may cause false positives.

### Improvement Suggestion
1. Add post-send verification:
   - Confirm sent bubble contains message text.
   - Re-open thread and verify last message text matches payload.
2. Return richer status:
   - `sent`, `verifiedInThread`, `verificationFailed`.
3. Add retry for transient failures:
   - Retry send once when verification fails due to timeout.

### Acceptance Test
- At least 9/10 automated sends must be verified in-thread within timeout.

---

## Bug 4: Connections page shows `No connections found`
Severity: Medium  
Status: Clarified (product behavior gap)

### Symptom
- Connections page empty even when LinkedIn account has existing connections.

### User Impact
- Users expect LinkedIn connection list, but page only reflects internal activity logs.

### Technical Evidence
- `app/(dashboard)/connections/page.tsx` uses `getAccountActivity(...)` and filters `type === 'connectionSent'`.
- It is not reading actual LinkedIn connection graph/list.

### Root Cause
- Current implementation is "sent-connections activity view", not "actual LinkedIn connections sync view".

### Improvement Suggestion
1. Rename UI label (short-term):
   - `Connections Sent Activity` to avoid expectation mismatch.
2. Implement real connection sync endpoint (long-term):
   - Add worker action to scrape/sync first-degree connections.
   - Persist in dedicated `connections` table.

### Acceptance Test
- Page should either clearly show activity-only data OR display real synced connection records.

---

## Bug 5: Session instability causes metadata and inbox degradation
Severity: High  
Status: Open

### Symptom
- Frequent session expiry leads to fallback data (`Unknown`, empty threads, failed sync windows).

### User Impact
- Unreliable monitoring dashboard until cookies are refreshed.

### Root Cause
- Cookie-based auth is inherently short-lived and can expire or be invalidated.
- Sync quality degrades when session validity is not proactively managed.

### Improvement Suggestion
1. Add session health scheduler:
   - Verify each account session periodically.
2. Add explicit session status in UI:
   - Warn before sync if account session is expired.
3. Add import audit fields:
   - `lastImportedAt`, `lastVerifiedAt`, `verifyResult`.

### Acceptance Test
- Dashboard should display session health and prevent misleading sync attempts for expired accounts.

---

## Priority Plan
P0 (Done in code):
1. Added thread live fallback + persistence when DB thread is empty.
2. Added post-send verification in `sendMessageNew`.
3. Improved metadata extraction/enrichment for unknown participants.

P1 (Next Sprint):
1. Session health monitor and UI indicators.
2. Real LinkedIn connection sync endpoint (not only activity view).
3. Automated e2e smoke workflow in deployment scripts.

P2 (Hardening):
1. Structured telemetry for parser failures.
2. Retry/backoff policies for sync and thread enrichment.
3. 24-hour stability test and alerting for session expiry.

---

## Suggested Test Checklist (Post-fix)
1. Import fresh cookies for both accounts.
2. Verify sessions via API.
3. Send message to known connected profile.
4. Validate:
   - participant name is not `Unknown`
   - thread shows actual messages (not 0)
   - recipient account can see message in LinkedIn UI
5. Validate connections page behavior against expected product definition.

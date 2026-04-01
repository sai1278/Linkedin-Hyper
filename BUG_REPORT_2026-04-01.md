# LinkedIn Hyper-V Bug Report and Improvement Plan
Date: 2026-04-01
Prepared by: Kanchi

## Executive Summary
The core monitoring flow is working: account session import, session verification, message send, inbox rendering, and activity feed updates are functional.

Main product bugs identified are now documented below with current status and improvement plan.

## Current Bug Register
1. `B-01` Unknown/generic participant name in inbox/activity.
Severity: High
Status: Fixed in code; deploy validation required on server.

2. `B-02` Thread opens with preview but zero visible messages.
Severity: High
Status: Fixed in code; needs full regression test on server.

3. `B-03` Send API says success but recipient visibility is inconsistent.
Severity: High
Status: Improved in code with verification logic; needs repeated run validation.

4. `B-04` Connections page shows empty/no connections.
Severity: Medium
Status: Product behavior gap; not a crash bug.

5. `B-05` Frequent session expiry (`SESSION_EXPIRED`) causes broken sync.
Severity: High
Status: Open (operational reliability issue).

6. `B-06` API origin/auth mismatch (`Forbidden: Invalid Origin`, `401/405`) in remote usage.
Severity: High
Status: Mostly fixed in code/scripts; requires correct deployment config and script usage.

## Detailed Bugs and Solutions

### B-01 Unknown or generic participant names in app
Observed:
- Inbox/activity sometimes shows `Unknown` or generic labels like `notifications total`.

Impact:
- User cannot identify real person.
- CRM trust is reduced.

Root Cause:
- LinkedIn DOM extraction sometimes fails or captures UI labels instead of person names.
- Fallback values get stored and shown.

Fix Implemented:
- Added participant-name normalization in backend and frontend.
- Blocked generic labels and fallback to profile URL slug parsing.

Files:
- `worker/src/index.js`
- `worker/src/actions/sendMessage.js`
- `worker/src/actions/sendMessageNew.js`
- `lib/display-name.ts`
- `components/notifications/NotificationItem.tsx`
- `components/dashboard/RecentActivity.tsx`
- `app/(dashboard)/connections/page.tsx`

Improvement Suggestion:
1. Add background metadata enrichment job for old rows.
2. Add `metadataQuality` flag in persisted records.
3. Alert if unknown-name rate exceeds threshold.

### B-02 Preview exists but selected thread shows zero messages
Observed:
- Left panel shows preview text, right panel shows `0 messages`.

Impact:
- Looks like data loss.
- Cannot continue conversation reliably from app.

Root Cause:
- In some cases DB thread records are incomplete or delayed.
- Thread endpoint previously depended too strongly on stored records.

Fix Implemented:
- Added fallback/read-hardening in worker thread and sync flows (already in recent commits).

Improvement Suggestion:
1. Enforce canonical thread ID mapping.
2. Save-on-read whenever fallback fetch succeeds.
3. Add automated test for preview-thread consistency.

### B-03 Send success response but recipient visibility inconsistent
Observed:
- API returns message sent, but recipient-side check may not always show message immediately.

Impact:
- Automation reliability concern for production.

Root Cause:
- UI automation success can happen before final server-side confirmation in some cases.
- Session/LinkedIn anti-bot challenges may interfere.

Fix Implemented:
- Added stronger post-send verification and safer retries in send flow.

Improvement Suggestion:
1. Return explicit fields: `sent`, `verifiedInThread`, `verificationFailed`.
2. Retry once on verification timeout.
3. Add result telemetry for send success vs verified success.

### B-04 Connections page empty
Observed:
- Connections tab shows no results.

Impact:
- Users expect actual LinkedIn connections list.

Root Cause:
- Current implementation shows connection activity entries, not full LinkedIn first-degree network sync.

Current Status:
- Functional as activity view.
- Not yet implemented as full LinkedIn connections mirror.

Improvement Suggestion:
1. Rename page to `Connection Activity` until full sync exists.
2. Build dedicated connection-sync worker and `connections` table.
3. Add last-sync timestamp and count.

### B-05 Session expires frequently
Observed:
- `SESSION_EXPIRED` appears after some time and blocks sync/send.

Impact:
- App appears broken until cookies are re-imported.

Root Cause:
- Cookie auth is short-lived and can be invalidated by LinkedIn security checks.

Improvement Suggestion:
1. Session health cron (verify each account every N minutes).
2. UI status chip: `Active`, `Expiring`, `Expired`.
3. One-click session refresh workflow and audit log.

### B-06 Remote API auth/origin inconsistencies
Observed:
- `Forbidden: Invalid Origin`, `401 Unauthorized`, `405 Method Not Allowed` during remote script tests.

Impact:
- Cookie import/test scripts fail intermittently in server environment.

Root Cause:
- API route auth token/origin config mismatch and mixed endpoint usage.

Fix Implemented:
- API script handling and route behavior hardened in recent commits.

Improvement Suggestion:
1. Standardize one base API URL for all scripts.
2. Add deployment precheck script to validate auth/origin/env.
3. Add clearer error messages for wrong token/origin.

## Recommended Priority Plan
1. `P0` Stability and trust
- Deploy latest fixes to server.
- Validate unknown-name and thread consistency with e2e smoke tests.
- Add session health checks.

2. `P1` Product completeness
- Implement real connection sync (not only activity).
- Add notification and profile-view consistency checks.

3. `P2` Hardening
- Add 24-hour continuous sync test.
- Add dashboards for sync failures, unknown names, and session expiry rate.

## Validation Checklist for Sir
1. Import fresh cookies for both accounts.
2. Verify account sessions from API.
3. Send message to known connected profile.
4. Confirm in app:
- no `Unknown` for known profiles
- thread shows actual messages
- activity feed entry appears
5. Confirm on LinkedIn account UI that message is visible.
6. Confirm connection/notification behavior matches product scope.

## Communication Note (Simple)
"Main flow is working now. Remaining work is reliability and completeness: session stability, full connection sync, and long-run monitoring validation."

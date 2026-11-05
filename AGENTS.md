# Standing owner requirements for Art TTM

Recorded 3 November 2026 at the explicit request of พี่เบนซ์.

- ChatGPT-to-LINE sharing is an ongoing requirement: text/information, files, and images must be sendable to the particular LINE group the owner specifies. Support all registered owner-authorized groups, including future groups; this does not authorize broadcasting a document to every group.
- Do not ask the owner to repeat this requirement each day. Read this file and CHATGPT_FILE_BRIDGE.md before diagnosing sharing.
- Cross-check the existing bridge, current deployed commit, runtime configuration, current client tools, and actual send evidence before claiming sending is unavailable or repaired. Server-side sends and an attached ChatGPT client are separate checks.
- Use the existing authenticated bridge; preserve group isolation, explicit destination resolution, byte verification, and duplicate-send guards. Do not bypass authentication or use a last-active group as destination.
- Do not claim delivery from a mock test or LINE API acceptance. Report code prepared, deployed, client connected, API accepted, and recipient receipt separately.
- Text, native image, and file download-link behavior must each be checked. Do not describe a download link as a native LINE file attachment.
- While actively working in Voice, provide a useful brief update about every 30 seconds, as requested by the owner. Do not ask again whether progress updates are wanted. Do not imply background work continues after a turn ends.
- The currently requested document is the Jaymart inspection/payment proposal, intended for the group the owner calls ห้ามคุยเล่น. Resolve that group from current records before sending; a historical renamed-group alias alone is insufficient.
- Record durable instructions in version control. This repository file is project memory; it does not automatically synchronize into every future ChatGPT conversation.

## Pre-send verification (owner instruction, 3 November 2026)

The owner requests an aviation-inspired read/do/verify discipline, including a right to challenge the owner when evidence is incomplete. Do not promise zero errors. Do not mark an unchecked item complete.

Before sending any corrected document:
1. Identify the exact source, current version, requested correction and authorized destination. A Thai font complaint about a file/link must not become a storefront-language rewrite.
2. Compare content with the authoritative source: names, figures, percentages, dates, units, totals and proposed versus approved conditions.
3. Render every final page, inspect Thai glyphs, marks, wrapping, table bounds and pagination; verify embedded Thai fonts in PDF. A successful file build alone is insufficient.
4. Verify the actual outgoing file bytes and format. Report what was and was not tested on the receiving device or link.
5. Latest owner clarification: cross-check independently and execute the authorized task without an extra draft-approval step; report the results afterwards. If a later instruction explicitly requires approval first, honor it. Missing critical evidence still blocks a claim of full verification.
6. Send once to the resolved group, reconcile the queue receipt and distinguish API acceptance from receipt/read confirmation.
7. If interrupted, resume from the last evidenced step. Any failed or unknown critical check blocks a claim of completion and must be stated plainly.

Reference for the adapted method (not an aircraft operating checklist): FAA-hosted Training Standardization Working Group report, 20 February 2024, checklist procedures pp. 45-46: https://www.faa.gov/sites/faa.gov/files/Revised-HS125-Curriculum-Report-20Feb24.pdf

## Verified live bridge evidence (5 November 2026)

- Owner reiterated: remember that ChatGPT can send text and file links through the existing bridge. Before saying sending is unavailable, read CHATGPT_FILE_BRIDGE.md and check the authenticated Supabase outbound queue route. Do not make the owner repeat this workflow.
- Current registry resolved `group:C450cf7f857b0b5e68c6acacf84de0b58` as `ห้ามคุยเล่น ❌❌TTM X Planing` on this date. Resolve against current records on future sends; never broadcast.
- UNO Mega Bangna cost workbook, 8 BOQ category tabs plus summary, was enqueued once as request `a007d6df-07e5-4cc7-ae1b-437b3e091db5`. Queue status `accepted`, result `accepted:true`, mode `download_link`, `delivery_confirmed:false`. Workbook SHA256: `d01575469c2f75188bbfe89f679f74cdc3909bb8362fc06f719c50543e472ab6`.
- Owner-requested follow-up text to พี่ปาน was request `ca79c0cc-ce06-4ddc-9640-9a61bae3b313`, status `accepted`, `delivery_confirmed:false`.
- This proves live LINE API acceptance through the queue, not recipient receipt/read confirmation or native Excel attachment support. Preserve duplicate-send guards; no test chatter in work groups.

# Art TTM LINE capabilities — 18 October 2026

This release adds durable, group-scoped jobs for document creation, image generation and editing, audio transcription, narrated still-image videos and public web research. A signed LINE webhook is required to enqueue ordinary user jobs. Results are stored before delivery. Delivery retries reuse the same LINE retry key and never regenerate an expensive result. Service-only internal smoke tests never send messages.

## Commands

| Example | Behavior |
| --- | --- |
| อาร์ต ทำ Word สรุปงานตามข้อความนี้… | Creates a DOCX document |
| อาร์ต ทำ PowerPoint สรุปงาน 5 สไลด์… | Creates a PPTX presentation |
| อาร์ต ทำ Excel รายการค่าใช้จ่าย… | Creates an XLSX workbook |
| อาร์ต ทำ PDF สรุปงาน… | Creates a PDF with a Thai font |
| อาร์ต สร้างภาพ 3D ร้านชา… | Generates a conceptual raster image, not a measured CAD model |
| อาร์ต แก้ภาพ… | Edits an archived image from this group |
| อาร์ต ถอดเสียงล่าสุด | Transcribes a recent archived audio/video file |
| อาร์ต สร้างคลิปแนะนำ… | Creates a still-image MP4 with synthetic Thai narration |
| อาร์ต ค้นเว็บ… | Searches public sources and returns source URLs |
| อาร์ต งานล่าสุด | Lists this room's five most recent jobs and delivery states |

## Validation

Run `node --test assistant-context.test.js tools.test.js knowledge-updates.test.js capability-report.test.js`. Tests cover real DOCX/PPTX/XLSX containers, Thai content and numeric values, MP4 generation, routing, scoped reads, independent context failures, event deduplication, failed delivery, silent processing and internal test isolation. Syntax checks cover every root JavaScript module. A sample Thai PDF was rendered and visually inspected. These local tests do not certify model accuracy or LINE delivery. Production smoke tests created and downloaded Thai DOCX/PDF files, performed public web research, and generated a narrated MP4. Audio transcription also ran end to end; its first result used Romanized Thai, so Thai prompting and the default transcription model were strengthened; the production retest returned Thai text, while proper names still require checking. No smoke-test result was sent to a LINE recipient.

## Current boundaries

- ChatGPT account history and personal memories are not automatically exported or synchronized. The bot reads only approved TTM internal knowledge plus the current room's stored content.
- Supplier knowledge imported from the named 15 October workbook includes seven complete tabs and its source references. It is historical supplier data, not live prices. An unreadable Sanmai BOQ was not imported.
- Gmail, Drive, GitHub and Render account actions require separately implemented authorization and adapters; ChatGPT connector credentials are not inherited by LINE.
- Preserving an existing Excel document's exact PDF layout still requires a suitable office conversion engine on the server. New PDF creation and simplified conversion are distinct operations.
- Videos currently contain one illustrative still and synthesized narration, not full-motion animation.
- Scheduled reminders are not implemented. A free web service can sleep, so a timer alone cannot guarantee scheduled delivery.
- Old LINE history from before the bot joined is unavailable through ordinary webhooks.
- Large attachments, transcripts, document sizes and slide counts have explicit bounds. Unsupported or incomplete inputs must be reported instead of invented.
- Interrupted running jobs require review; they are not automatically replayed. Pending delivery retries are bounded to five attempts within 23 hours.

## Continuous information updates

New LINE file/image analyses are patched back to their existing scoped archive records after successful reading. Explicit work facts and corrections enter scoped long-term memory with timestamps. Questions are not treated as new financial facts, and mention parsing no longer invents relationships. Shared sources retain their versions and only the newest source revision is loaded.

The owner separately enabled a weekly Friday ChatGPT automation to check authorized corporate Library updates and real capability evidence. This is weekly source checking, not a real-time export of all ChatGPT conversations. The capability command reports evidence from the requesting room and excludes internal tests and silent processing. It distinguishes LINE accepting a send request from the user opening or verifying a file.


## 3 November 2026 maintenance release

Code release `4d5ebb50e740373518dfaa507d6e4f6c903a44cc` was deployed and its public health response verified. Generic audio/video file messages are no longer sent to the document reader, and document read/failed results are audited without replaying paid analysis. Ordinary-conversation web search is opt-in through `TTM_CONVERSATION_WEB_SEARCH=1`; it remains off by default to avoid introducing extra search calls. The existing explicit research command is a separate operation. Startup slip audits additionally require `TTM_SANMAI_AUDIT_STARTUP_APPROVED=1` and must not be enabled without reviewing cost and authorization.

`node --test release-notice.test.js` passed six internal mock tests, including media preservation/auditing, insufficient quota, inaccessible groups, public-release verification, duplicate suppression, and no automatic retry after a rejected send. These tests made no real OpenAI or LINE calls and do not certify model accuracy or end-to-end user commands.

The owner-authorized release notice reads only explicitly queued recipients, verifies current group access and available quota, checks the public release before sending, and records LINE's acceptance separately from actual opening or capability validation. Claimed sends are not automatically replayed. A release notice is not a successful test of every advertised command. Existing capability boundaries above still apply.

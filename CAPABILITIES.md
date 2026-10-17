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

Run `node --test assistant-context.test.js tools.test.js`. Tests cover real DOCX/PPTX/XLSX containers, Thai content and numeric values, MP4 generation, routing, scoped reads, independent context failures, event deduplication, failed delivery, silent processing and internal test isolation. Syntax checks cover every root JavaScript module. A sample Thai PDF was rendered and visually inspected. These local tests do not certify model accuracy or LINE delivery. Production deployment and smoke tests are tracked separately.

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

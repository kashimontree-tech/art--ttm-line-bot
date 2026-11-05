# ChatGPT ↔ LINE file bridge

## Owner-authorized queue fallback (3 November 2026)

When this ChatGPT session has no custom MCP tools attached, use the connected
Supabase service/admin SQL tool to enqueue explicitly requested sends in
`public.ttm_outbound_requests`. This table is service-only: RLS enabled and
all privileges revoked from PUBLIC, anon and authenticated. Never grant public
enqueue access. No credentials need to enter ChatGPT context.

Resolve the exact group in `ttm_group_registry` first. Insert one request with
`authorized_by=owner_explicit_chatgpt`, a concrete `authorization_note`,
`scope_id`, `kind` and `payload`. Text payload is `{text:...}`; a file payload
is `{name:...,base64:...,caption:...}` or an already archived same-group
`{file_id:...,caption:...}`. Do not enqueue absent explicit send authorization.
The worker checks current LINE group access, claims pending rows atomically,
and reuses the request UUID as the LINE retry key. Requests expire in 30 minutes.
It never automatically replays `sending` or `failed` rows. Reconcile uncertain
receipts before any retry. A sleeping free service may need a health request
to wake it; queue insertion alone is not evidence of sending.

Read the same row's status/result after enqueue. Only `accepted` with an actual
LINE result establishes API acceptance; this is still not recipient receipt.
This is a server queue workflow, not proof a custom MCP plugin was installed.

All registered groups are eligible for individually authorized owner requests;
do not broadcast to all groups. Existing MCP allowlists remain independently
configured. Optional `TTM_CHATGPT_BRIDGE_ALL_REGISTERED_GROUPS=1` expands MCP
scope checks to registered groups; default remains the explicit static list.

Markdown imports are supported as `text/markdown`, in addition to the existing
formats. Other native-image and temporary download-link limits below apply.

This adds an owner-only stateless MCP endpoint at `/mcp/ttm-files`. It reuses
the TTM app's existing group archive, private storage, and indexing adapters.
It does not connect a ChatGPT account or save anything in ChatGPT Library by
itself. Existing automatic LINE archiving is unchanged.

## Configuration and connection

- `TTM_CHATGPT_BRIDGE_TOKEN`: a new random secret of at least 32 characters,
  supplied by the MCP client as an Authorization Bearer header. Never reuse
  the LINE channel token, database key, or a short app PIN.
- `TTM_CHATGPT_BRIDGE_SCOPES`: JSON array of explicitly owner-authorized
  `group:C…` scope IDs. Empty or invalid configuration disables the endpoint.
- `LINE_CHANNEL_ACCESS_TOKEN`: existing server-side LINE token, used only for
  the send tool. Neither this token nor database credentials are returned.
- Deploy and connect a custom MCP client supporting authenticated stateless
  Streamable HTTP JSON responses to the server's HTTPS endpoint. Compatibility
  and available authentication options must be tested in the actual ChatGPT
  client before calling this feature activated. OAuth is not implemented here.

## Tools and intended workflow

1. `list_groups`: names and exact scope IDs, filtered to the allowlist.
2. `list_files`: one group's stored originals, optional literal filename query,
   offset pagination (maximum 100 records/page). Follow `next_offset` until null.
3. `get_file`: group-bound file ID → temporary 15-minute original download URL.
4. `import_file`: up to 12 MiB of canonical base64 → upload, byte readback/hash
   verification, archive index, returned file ID. Does not send to LINE.
5. `send_file`: exact group and archive ID → LINE push. Caller supplies a UUID
   `request_id`, reused only for identical retries to avoid duplicate sends.

ChatGPT → LINE: resolve the requested group unambiguously, retrieve the requested
ChatGPT file locally, import its bytes, then send its returned ID only when the
user instructed sending. No live send is performed by installation or startup.

LINE → ChatGPT: find an already archived original, get its link, download into
the active workspace, then use the available ChatGPT Library file-create tool.
Only a successful Library result establishes that the file is saved there.
Automatic background sync into Library is **not implemented** by this endpoint;
it requires a separate supported authorized execution workflow.

## Current limits

- JPEG/PNG up to 1 MiB can use the original as LINE's preview. Larger images and
  other types are sent as one-hour download links. LINE may reject unsupported
  image dimensions or malformed media; errors must not be reported as success.
- PDF/Excel are download links, not native LINE file attachments.
- API acceptance is not proof of receipt, group membership, or a read message.
- The endpoint sees only originals already archived by the bot. It cannot fetch
  all historical group conversations, LINE Notes, or expired missing content.
- No automatic retry queue or Library background sync is added here. Failed
  operations return errors. An interrupted import may leave unindexed storage
  bytes; do not assume completion or repeat a send with a new retry key.
- Shared bearer access is restricted to the explicit allowlist, not per-person
  OAuth authorization. Do not enable it for untrusted multi-user access.

## Validation

`node --test chatgpt-file-bridge.test.js`

Tests use fake storage/database/LINE adapters. They cover fail-closed auth,
cross-group denial, pagination, literal filename filters, byte verification,
index failure, native images versus links, LINE rejection, retry acceptance,
and MCP initialization/tool discovery/error sanitization. No live LINE messages
are sent. Live deployment, client connection, a real send, and actual Library
writeback remain unverified.

## Explicit one-image live test

The owner-authorized smoke test runs only when `TTM_BRIDGE_SMOKE_TEST_ID`
(a unique UUID) and `TTM_BRIDGE_SMOKE_TEST_SCOPE` (the verified exact group)
are configured. It archives a neutral test PNG, verifies its bytes/index, then
sends one native image with a Thai test notice to that group. A durable receipt
and LINE retry key prevent repeats across restarts. Unfinished receipts older
than 23 hours require manual review. No other group receives this test.
After the test, clear these two opt-in values for future deploys.

This tests the server-side archive/send adapters; it is not a test of a connected
ChatGPT MCP client or of a ChatGPT Library save. Those are separate verification
steps. `node --test chatgpt-file-bridge.test.js bridge-smoke-test.test.js` also
checks the single-send receipt and expired-retry guards without live messages.


## Explicit user mentions (5 November 2026)

`send_text` and owner queue text payloads accept optional `mentions`:
`{"text":"{pan} อาร์ตแยกไฟล์ต้นทุนแล้วค่ะ","mentions":[{"key":"pan","user_id":"U..."}]}`.
Resolve the recipient from the exact group's current records before enqueueing;
never infer a LINE account from a nickname alone. With mentions supplied, text
is a LINE textV2 template. Each key must occur exactly once as `{key}`; double
braces represent literal braces. At most 20 distinct user targets are allowed.
The bridge checks each user through that group's live member-profile endpoint
and refuses sending if membership or returned identity cannot be verified.
No all-members mentions are supported. Plain messages remain unchanged.
Queue `accepted` still means API acceptance, never confirmed reading.

## File activity buttons (5 November 2026)

New file-link sends include explicit group buttons for requesting a link,
self-reporting that the file has been read, and viewing names/counts. A signed
LINE postback identifies the acting account. Events are stored durably before
webhook acknowledgement, bound to the exact group and archived file. Repeated
clicks count as one person per action. No schema or public access changes.
`get_file_activity` returns the same group-scoped activity to the owner bridge.

A link request is not a download/open event. A read acknowledgment is a user's
statement, not proof of reading. Existing direct links and native-image sends
are not tracked. Reports cap stored events at 1,000 and label limited results;
LINE text reports show the first 15 distinct names per action. All future
reports must keep these distinctions. No historical read status can be recovered.

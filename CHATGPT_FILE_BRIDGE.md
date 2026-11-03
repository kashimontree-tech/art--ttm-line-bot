# ChatGPT ↔ LINE file bridge (prepared, not activated)

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

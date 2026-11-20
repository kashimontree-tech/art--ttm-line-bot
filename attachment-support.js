const ARCHIVE_FILE_RE = /\.(?:zip|rar|7z|tar|tgz|gz|bz2|xz)$/i;
const MEDIA_MIME_RE = /^(?:video|audio)\//i;
const MEDIA_FILE_RE = /\.(?:mp4|mov|m4v|webm|avi|mkv|mp3|m4a|wav|ogg|aac|flac)$/i;

function unsupportedDocumentReason(fileName, mime) {
  const name = String(fileName || "");
  if (MEDIA_MIME_RE.test(String(mime || "")) || MEDIA_FILE_RE.test(name)) {
    return "Audio/video sent as file is not supported by the document reader";
  }
  if (ARCHIVE_FILE_RE.test(name)) {
    return "Archive files are stored but are not supported by the document reader";
  }
  return null;
}

module.exports = { unsupportedDocumentReason };

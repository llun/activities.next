// Minimal HTML entity escaping for plain text that is interpolated into
// HTML-typed API fields (instance extended_description, oEmbed html, the raw
// HTML a policy's Markdown shows as text). `&` must be replaced first.
export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

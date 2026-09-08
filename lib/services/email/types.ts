/**
 * What every `build*Email()` template module returns: a subject plus the two
 * media that must stay in step. Templates never assemble a `Message` themselves
 * — the caller supplies `from`/`to` and spreads this in, so a template stays a
 * pure function of its inputs and can be rendered in a test or a preview script
 * without any mail configuration.
 */
export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

import fs from 'fs'
import path from 'path'

// `exportActorArchive` resolves the remote-attachment byte cap from the
// `media.maxFileSize` server setting and threads it into
// `registerAttachmentUrl`. Reverting that to the compile-time `MAX_FILE_SIZE`
// constant is INVISIBLE to every result-based test: `registerAttachmentUrl`
// takes the cap as a parameter, so its own tests pass whatever they like and
// still pass, and no test drives `exportActorArchive` end to end (it wants a
// database, a staging directory and a tar writer).
//
// The revert is not theoretical — it is what the first version of this code
// did, and it refused remote attachments this instance's own upload path would
// have accepted, because `MAX_FILE_SIZE` is only the DEFAULT for a setting an
// admin may raise to `MAX_CONFIGURABLE_FILE_SIZE` (1 GiB).
//
// So the shape is asserted directly, the same way this repo pins other
// revert-invisible decisions.
const SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'scripts', 'backup', 'actorArchive.ts'),
  'utf-8'
)

describe('actor archive remote attachment cap', () => {
  it('resolves the cap from the media.maxFileSize server setting', () => {
    expect(SOURCE).toContain('getMaxMediaUploadSize(database)')
  })

  it('threads the resolved cap into registerAttachmentUrl', () => {
    expect(SOURCE).toContain('maxAttachmentBytes')
    // The resolved value, not a fresh constant read at the call site.
    expect(SOURCE).toMatch(
      /maxAttachmentBytes = args\.fetchRemoteAttachments\s*\n?\s*\? await getMaxMediaUploadSize\(database\)/
    )
  })

  it('does not import the compile-time upload size constant', () => {
    // Prose may still MENTION the constant to explain why it is wrong, so this
    // asserts on the import rather than on any occurrence of the name.
    expect(SOURCE).not.toMatch(
      /^import\s[^\n]*\bMAX_FILE_SIZE\b[\s\S]*?from '@\/lib\/services\/medias\/constants'/m
    )
  })
})

import type { Status } from '@/lib/types/domain/status'

import {
  buildSubmitRequest,
  postBoxNoteFingerprint,
  postBoxPollFingerprint,
  replyBoxFingerprint,
  uploadedDraftAttachment
} from './submitRequest'
import type { DraftAttachment, DraftRecord } from './types'

const target = (id: string) => ({ id }) as unknown as Status

const draft = (patch: Partial<DraftRecord> = {}): DraftRecord => ({
  id: 'draft-1',
  accountId: 'account-1',
  actorId: 'https://llun.test/users/me',
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  composer: 'post-box',
  text: 'Hello',
  contentWarning: 'CW',
  contentWarningVisible: false,
  visibility: 'public',
  quoteApprovalPolicy: 'public',
  attachments: [],
  ...patch
})

const uploaded = (patch: Partial<DraftAttachment> = {}): DraftAttachment => ({
  localId: 'local-1',
  mediaId: 'media-1',
  owned: true,
  mediaType: 'image/png',
  fileName: 'a.png',
  url: 'https://llun.test/a.png',
  width: 10,
  height: 20,
  description: 'Alt',
  decorative: false,
  hasBlob: true,
  ...patch
})

// These literals are what PostBox and StatusReplyBox built inline before the
// fingerprints moved here. PR 2 drafts on users' devices hold them, so they
// must never change.
describe('fingerprints (golden, byte-identical to the composers)', () => {
  it('PostBox note', () => {
    expect(
      postBoxNoteFingerprint({
        message: 'Hi',
        contentWarning: '',
        replyStatusId: null,
        quotedStatusId: 'q1',
        attachmentIds: ['m1', 'm2'],
        fitnessFileId: null,
        visibility: 'unlisted',
        quoteApprovalPolicy: 'followers'
      })
    ).toBe(
      '{"type":"note","message":"Hi","contentWarning":"","replyStatusId":null,"quotedStatusId":"q1","attachmentIds":["m1","m2"],"fitnessFileId":null,"visibility":"unlisted","quoteApprovalPolicy":"followers"}'
    )
  })

  it('PostBox poll', () => {
    expect(
      postBoxPollFingerprint({
        message: 'Q',
        contentWarning: 'cw',
        choices: ['a', 'b'],
        durationInSeconds: 1800,
        pollType: 'anyOf',
        replyStatusId: 'r1',
        visibility: 'public'
      })
    ).toBe(
      '{"type":"poll","message":"Q","contentWarning":"cw","choices":["a","b"],"durationInSeconds":1800,"pollType":"anyOf","replyStatusId":"r1","visibility":"public"}'
    )
  })

  it('reply box, with and without a content warning or language', () => {
    expect(
      replyBoxFingerprint({
        message: 'Re',
        contentWarning: undefined,
        inReplyToId: 'r1',
        visibility: 'private',
        language: undefined,
        attachmentIds: []
      })
    ).toBe(
      '{"message":"Re","contentWarning":null,"inReplyToId":"r1","visibility":"private","language":null,"attachmentIds":[]}'
    )
    expect(
      replyBoxFingerprint({
        message: 'Re',
        contentWarning: 'cw',
        inReplyToId: 'r1',
        visibility: 'private',
        language: 'en',
        attachmentIds: ['m1']
      })
    ).toBe(
      '{"message":"Re","contentWarning":"cw","inReplyToId":"r1","visibility":"private","language":"en","attachmentIds":["m1"]}'
    )
  })
})

describe('uploadedDraftAttachment', () => {
  it('maps the uploaded branch', () => {
    expect(
      uploadedDraftAttachment({
        ...uploaded(),
        mediaId: 'media-1',
        posterUrl: 'https://llun.test/p.png'
      })
    ).toEqual({
      type: 'upload',
      id: 'media-1',
      mediaType: 'image/png',
      url: 'https://llun.test/a.png',
      posterUrl: 'https://llun.test/p.png',
      width: 10,
      height: 20,
      name: 'Alt'
    })
  })

  it('defaults a missing url and size', () => {
    const item = uploadedDraftAttachment({
      ...uploaded({ url: undefined, width: undefined, height: undefined }),
      mediaId: 'media-1'
    })
    expect(item).toMatchObject({ url: '', width: 0, height: 0 })
  })
})

describe('buildSubmitRequest', () => {
  describe('post-box note', () => {
    it('maps a plain note and matches the PostBox fingerprint', () => {
      const request = buildSubmitRequest(
        draft({
          replyTo: target('r1'),
          quoteOf: target('q1'),
          attachments: [uploaded()],
          visibility: 'unlisted',
          quoteApprovalPolicy: 'nobody',
          fitnessFile: {
            localId: 'f1',
            fileName: 'run.fit',
            mimeType: 'application/vnd.ant.fit',
            size: 5,
            fitnessFileId: 'fit-1',
            owned: true,
            hasBlob: true
          }
        })
      )

      expect(request.kind).toBe('note')
      expect(request.params).toEqual({
        message: 'Hello',
        contentWarning: '',
        replyStatus: target('r1'),
        quotedStatus: target('q1'),
        attachments: [expect.objectContaining({ id: 'media-1' })],
        fitnessFileId: 'fit-1',
        visibility: 'unlisted',
        quoteApprovalPolicy: 'nobody'
      })
      expect(request.params).not.toHaveProperty('language')
      expect(request.fingerprint).toBe(
        '{"type":"note","message":"Hello","contentWarning":"","replyStatusId":"r1","quotedStatusId":"q1","attachmentIds":["media-1"],"fitnessFileId":"fit-1","visibility":"unlisted","quoteApprovalPolicy":"nobody"}'
      )
    })

    it('uses nulls for absent targets and the content warning only when shown', () => {
      const hidden = buildSubmitRequest(draft())
      expect(hidden.fingerprint).toBe(
        '{"type":"note","message":"Hello","contentWarning":"","replyStatusId":null,"quotedStatusId":null,"attachmentIds":[],"fitnessFileId":null,"visibility":"public","quoteApprovalPolicy":"public"}'
      )
      const shown = buildSubmitRequest(draft({ contentWarningVisible: true }))
      expect(shown.params).toMatchObject({ contentWarning: 'CW' })
      expect(shown.fingerprint).toContain('"contentWarning":"CW"')
    })

    it('throws when an attachment has no mediaId', () => {
      expect(() =>
        buildSubmitRequest(
          draft({ attachments: [uploaded({ mediaId: undefined })] })
        )
      ).toThrow('a.png has not been uploaded')
    })

    it('throws when the fitness file has no fitnessFileId', () => {
      expect(() =>
        buildSubmitRequest(
          draft({
            fitnessFile: {
              localId: 'f1',
              fileName: 'run.fit',
              mimeType: 'application/vnd.ant.fit',
              size: 5,
              owned: true,
              hasBlob: true
            }
          })
        )
      ).toThrow('run.fit has not been uploaded')
    })
  })

  describe('post-box poll', () => {
    const poll = {
      choices: ['a', 'b'],
      durationInSeconds: 1800 as const,
      pollType: 'oneOf' as const
    }

    it('maps a poll and matches the PostBox fingerprint', () => {
      const request = buildSubmitRequest(
        draft({
          poll,
          replyTo: target('r1'),
          contentWarningVisible: true
        })
      )
      expect(request).toEqual({
        kind: 'poll',
        params: {
          message: 'Hello',
          contentWarning: 'CW',
          choices: ['a', 'b'],
          durationInSeconds: 1800,
          pollType: 'oneOf',
          replyStatus: target('r1'),
          visibility: 'public'
        },
        fingerprint:
          '{"type":"poll","message":"Hello","contentWarning":"CW","choices":["a","b"],"durationInSeconds":1800,"pollType":"oneOf","replyStatusId":"r1","visibility":"public"}'
      })
    })

    it('ignores attachments (a poll has none) and uses null without a reply', () => {
      const request = buildSubmitRequest(
        draft({ poll, attachments: [uploaded({ mediaId: undefined })] })
      )
      expect(request.kind).toBe('poll')
      expect(request.fingerprint).toContain('"replyStatusId":null')
      expect(request.fingerprint).toContain('"contentWarning":""')
    })
  })

  describe('reply-box', () => {
    it('maps a reply and matches the StatusReplyBox fingerprint', () => {
      const request = buildSubmitRequest(
        draft({
          composer: 'reply-box',
          replyTo: target('r1'),
          language: 'en',
          visibility: 'private',
          contentWarningVisible: true,
          attachments: [uploaded()]
        })
      )
      expect(request.kind).toBe('note')
      expect(request.params).toEqual({
        message: 'Hello',
        contentWarning: 'CW',
        replyStatus: target('r1'),
        inReplyToId: 'r1',
        visibility: 'private',
        language: 'en',
        attachments: [expect.objectContaining({ id: 'media-1' })]
      })
      expect(request.fingerprint).toBe(
        '{"message":"Hello","contentWarning":"CW","inReplyToId":"r1","visibility":"private","language":"en","attachmentIds":["media-1"]}'
      )
    })

    it('leaves the content warning undefined (null in the fingerprint) when hidden', () => {
      const request = buildSubmitRequest(
        draft({ composer: 'reply-box', replyTo: target('r1') })
      )
      expect(request.params).toMatchObject({
        contentWarning: undefined,
        language: undefined
      })
      expect(request.fingerprint).toBe(
        '{"message":"Hello","contentWarning":null,"inReplyToId":"r1","visibility":"public","language":null,"attachmentIds":[]}'
      )
    })

    it('throws without a reply target and on a missing mediaId', () => {
      expect(() =>
        buildSubmitRequest(draft({ composer: 'reply-box' }))
      ).toThrow('no post to reply to')
      expect(() =>
        buildSubmitRequest(
          draft({
            composer: 'reply-box',
            replyTo: target('r1'),
            attachments: [uploaded({ mediaId: undefined })]
          })
        )
      ).toThrow('has not been uploaded')
    })
  })
})

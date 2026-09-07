import { describe, expect, it, vi } from 'vitest'

import { getNote } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { CREATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { StatusType } from '@/lib/types/domain/status'

import { importRemoteStatus, parseArgs } from './importRemoteStatus'

vi.mock('@/lib/activities', () => ({
  getNote: vi.fn()
}))

vi.mock('@/lib/jobs/createNoteJob', () => ({
  createNoteJob: vi.fn()
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue(undefined)
}))

describe('importRemoteStatus parseArgs', () => {
  it('parses statusUrl correctly', () => {
    expect(
      parseArgs(['https://mastodon.in.th/@lluu/117228726176772772'])
    ).toEqual({
      statusUrl: 'https://mastodon.in.th/@lluu/117228726176772772',
      dryRun: false
    })
  })

  it('parses --dry-run flag', () => {
    expect(
      parseArgs([
        'https://mastodon.in.th/@lluu/117228726176772772',
        '--dry-run'
      ])
    ).toEqual({
      statusUrl: 'https://mastodon.in.th/@lluu/117228726176772772',
      dryRun: true
    })
    expect(
      parseArgs([
        '--dry-run=true',
        'https://mastodon.in.th/@lluu/117228726176772772'
      ])
    ).toEqual({
      statusUrl: 'https://mastodon.in.th/@lluu/117228726176772772',
      dryRun: true
    })
    expect(
      parseArgs([
        'https://mastodon.in.th/@lluu/117228726176772772',
        '--dry-run=false'
      ])
    ).toEqual({
      statusUrl: 'https://mastodon.in.th/@lluu/117228726176772772',
      dryRun: false
    })
  })

  it('throws on missing statusUrl', () => {
    expect(() => parseArgs([])).toThrow('Missing required statusUrl argument')
    expect(() => parseArgs(['--dry-run'])).toThrow(
      'Missing required statusUrl argument'
    )
  })

  it('throws on unexpected arguments', () => {
    expect(() =>
      parseArgs([
        'https://mastodon.in.th/@lluu/117228726176772772',
        '--unknown'
      ])
    ).toThrow('Unexpected argument: --unknown')
    expect(() =>
      parseArgs([
        'https://mastodon.in.th/@lluu/117228726176772772',
        'https://example.com'
      ])
    ).toThrow('Unexpected extra argument: https://example.com')
  })
})

describe('importRemoteStatus', () => {
  const mockNote = {
    id: 'https://mastodon.in.th/users/lluu/statuses/117228726176772772',
    type: 'Note',
    attributedTo: 'https://mastodon.in.th/users/lluu',
    inReplyTo:
      'https://llun.dev/users/null/statuses/01a07ae4-85cd-73fb-a153-4384565ae994',
    published: '2026-09-07T08:06:44Z',
    url: 'https://mastodon.in.th/@lluu/117228726176772772',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [
      'https://mastodon.in.th/users/lluu/followers',
      'https://llun.dev/users/null'
    ],
    content: 'Hello fediverse'
  }

  it('returns preview in dry-run mode without calling createNoteJob', async () => {
    vi.mocked(getNote).mockResolvedValueOnce(mockNote as any)
    const mockDatabase = {} as Database

    const result = await importRemoteStatus(mockDatabase, {
      statusUrl: 'https://mastodon.in.th/@lluu/117228726176772772',
      dryRun: true
    })

    expect(result).toEqual({
      statusId: mockNote.id,
      publicId: '(dry-run)',
      actorId: mockNote.attributedTo,
      reply: mockNote.inReplyTo,
      url: mockNote.url,
      createdAt: '2026-09-07T08:06:44.000Z'
    })
    expect(createNoteJob).not.toHaveBeenCalled()
  })

  it('calls createNoteJob and returns stored status details', async () => {
    vi.mocked(getNote).mockResolvedValueOnce(mockNote as any)
    const mockStoredStatus = {
      id: mockNote.id,
      publicId: '01991234-5678-7abc-8def-0123456789ab',
      actorId: mockNote.attributedTo,
      type: StatusType.enum.Note,
      reply: mockNote.inReplyTo,
      url: mockNote.url,
      createdAt: new Date(mockNote.published).getTime()
    }

    const mockDatabase = {
      getStatus: vi.fn().mockResolvedValue(mockStoredStatus)
    } as unknown as Database

    const result = await importRemoteStatus(mockDatabase, {
      statusUrl: 'https://mastodon.in.th/@lluu/117228726176772772'
    })

    expect(createNoteJob).toHaveBeenCalledWith(mockDatabase, {
      id: mockNote.id,
      name: CREATE_NOTE_JOB_NAME,
      data: mockNote,
      verifiedSenderActorId: mockNote.attributedTo
    })

    expect(result).toEqual({
      statusId: mockNote.id,
      publicId: '01991234-5678-7abc-8def-0123456789ab',
      actorId: mockNote.attributedTo,
      reply: mockNote.inReplyTo,
      url: mockNote.url,
      createdAt: '2026-09-07T08:06:44.000Z'
    })
  })

  it('throws if getNote returns null', async () => {
    vi.mocked(getNote).mockResolvedValueOnce(null)
    const mockDatabase = {} as Database

    await expect(
      importRemoteStatus(mockDatabase, {
        statusUrl: 'https://mastodon.in.th/@lluu/117228726176772772'
      })
    ).rejects.toThrow(
      'Failed to fetch remote status from https://mastodon.in.th/@lluu/117228726176772772'
    )
  })
})

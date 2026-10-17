import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

import { getVisibility } from './getVisibility'

describe('getVisibility', () => {
  it('returns public when to contains ACTIVITY_STREAM_PUBLIC', () => {
    expect(getVisibility([ACTIVITY_STREAM_PUBLIC], [])).toEqual('public')
    expect(
      getVisibility(
        [ACTIVITY_STREAM_PUBLIC, 'https://example.com/users/test/followers'],
        ['https://example.com/users/someone']
      )
    ).toEqual('public')
  })

  it('returns public when to contains as:Public compact form', () => {
    expect(getVisibility([ACTIVITY_STREAM_PUBLIC_COMPACT], [])).toEqual(
      'public'
    )
    expect(
      getVisibility(
        [
          ACTIVITY_STREAM_PUBLIC_COMPACT,
          'https://example.com/users/test/followers'
        ],
        ['https://example.com/users/someone']
      )
    ).toEqual('public')
  })

  it('returns unlisted when cc contains Public but to does not', () => {
    expect(
      getVisibility(
        ['https://example.com/users/test/followers'],
        [ACTIVITY_STREAM_PUBLIC]
      )
    ).toEqual('unlisted')
    expect(
      getVisibility(
        ['https://example.com/users/test/followers'],
        [ACTIVITY_STREAM_PUBLIC_COMPACT]
      )
    ).toEqual('unlisted')
  })

  it('returns private when to/cc contains followers URL but no Public', () => {
    expect(
      getVisibility(
        ['https://example.com/users/test/followers'],
        ['https://example.com/users/someone']
      )
    ).toEqual('private')
    expect(
      getVisibility(
        ['https://example.com/users/someone'],
        ['https://example.com/users/test/followers']
      )
    ).toEqual('private')
  })

  it('returns direct when to contains specific users only', () => {
    expect(getVisibility(['https://example.com/users/someone'], [])).toEqual(
      'direct'
    )
    expect(
      getVisibility(
        [
          'https://example.com/users/someone',
          'https://example.com/users/another'
        ],
        ['https://example.com/users/third']
      )
    ).toEqual('direct')
  })

  it('returns direct when to and cc are empty', () => {
    expect(getVisibility([], [])).toEqual('direct')
  })

  it('returns public/unlisted for the bare Public term', () => {
    expect(getVisibility(['Public'], [])).toEqual('public')
    expect(getVisibility([], ['Public'])).toEqual('unlisted')
  })

  it('detects a followers collection that does not end in /followers', () => {
    const followersUrl = 'https://friendica.example/followers/alice'
    expect(getVisibility([followersUrl], [])).toEqual('direct')
    expect(getVisibility([followersUrl], [], followersUrl)).toEqual('private')
    expect(
      getVisibility([], [followersUrl], 'https://friendica.example/other')
    ).toEqual('direct')
  })

  it('keeps the /followers suffix as a fallback', () => {
    expect(
      getVisibility(
        ['https://misskey.example/users/x/followers'],
        [],
        'https://misskey.example/different'
      )
    ).toEqual('private')
  })
})

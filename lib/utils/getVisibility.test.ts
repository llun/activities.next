import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMACT
} from '@/lib/utils/jsonld/activitystream'

import { getVisibility } from './getVisibility'

describe('#getVisibility', () => {
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
    expect(getVisibility([ACTIVITY_STREAM_PUBLIC_COMACT], [])).toEqual('public')
    expect(
      getVisibility(
        [ACTIVITY_STREAM_PUBLIC_COMACT, 'https://example.com/users/test/followers'],
        ['https://example.com/users/someone']
      )
    ).toEqual('public')
  })

  it('returns unlist when cc contains Public but to does not', () => {
    expect(
      getVisibility(
        ['https://example.com/users/test/followers'],
        [ACTIVITY_STREAM_PUBLIC]
      )
    ).toEqual('unlist')
    expect(
      getVisibility(
        ['https://example.com/users/test/followers'],
        [ACTIVITY_STREAM_PUBLIC_COMACT]
      )
    ).toEqual('unlist')
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
    expect(
      getVisibility(
        ['https://example.com/users/someone'],
        []
      )
    ).toEqual('direct')
    expect(
      getVisibility(
        ['https://example.com/users/someone', 'https://example.com/users/another'],
        ['https://example.com/users/third']
      )
    ).toEqual('direct')
  })

  it('returns direct when to and cc are empty', () => {
    expect(getVisibility([], [])).toEqual('direct')
  })
})

import { Actor } from '@/lib/types/domain/actor'

import { selectAccountActor } from './selectAccountActor'

const actor = (id: string, deletionStatus?: Actor['deletionStatus']): Actor =>
  ({
    id,
    username: id,
    domain: 'llun.test',
    deletionStatus: deletionStatus ?? null
  }) as Actor

describe('selectAccountActor', () => {
  it('returns null when the account owns no actors', () => {
    expect(selectAccountActor([], 'https://llun.test/users/first')).toBeNull()
  })

  it('returns the default actor when it is still usable', () => {
    const actors = [actor('first'), actor('second')]
    expect(selectAccountActor(actors, 'second')?.id).toEqual('second')
  })

  it('falls back to the first live actor when no default actor is set', () => {
    const actors = [actor('first'), actor('second')]
    expect(selectAccountActor(actors, null)?.id).toEqual('first')
    expect(selectAccountActor(actors, undefined)?.id).toEqual('first')
  })

  it('falls back to the first live actor when the default actor is unknown', () => {
    const actors = [actor('first'), actor('second')]
    expect(selectAccountActor(actors, 'deleted-actor')?.id).toEqual('first')
  })

  it('skips a default actor that is pending deletion', () => {
    const actors = [actor('first', 'scheduled'), actor('second')]
    expect(selectAccountActor(actors, 'first')?.id).toEqual('second')
  })

  it('returns null when every actor is pending deletion', () => {
    const actors = [actor('first', 'scheduled'), actor('second', 'deleting')]
    expect(selectAccountActor(actors, 'first')).toBeNull()
  })
})

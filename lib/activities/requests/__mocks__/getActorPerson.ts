import { MockActivityPubPerson } from '@/lib/stub/person'

import { GetActorPersonFunction } from '../getActorPerson'

export const getActorPerson: GetActorPersonFunction = jest.fn(
  async ({ actorId }) => MockActivityPubPerson({ id: actorId })
)

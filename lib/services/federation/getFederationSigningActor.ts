import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'

export const getFederationSigningActor = async (
  database: Database,
  preferredActor?: Actor
): Promise<Actor | undefined> => {
  if (preferredActor?.privateKey) return preferredActor

  return (await database.getFederationSigningActor()) ?? undefined
}

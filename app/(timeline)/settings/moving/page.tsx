import { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { Alert } from '@/lib/components/surface/Alert'
import { Section } from '@/lib/components/surface/Section'
import { getDatabase } from '@/lib/database'
import { getHandleState } from '@/lib/services/accounts/handleRename'
import { getMigrationState } from '@/lib/services/accounts/migration/outgoingMove'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { AliasesSection } from './AliasesSection'
import { HandleRenameForm } from './HandleRenameForm'
import { MoveForm } from './MoveForm'
import { MovedNotice } from './MovedNotice'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Moving'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  // The same services the GET routes answer from, so the first paint already
  // holds the handle, the aliases and the move state.
  const handle = await getHandleState({
    database,
    actor,
    currentHost: headerHost(await headers())
  })
  const aliases = await Promise.all(
    (actor.alsoKnownAs ?? []).map(async (aliasId) => {
      const row = await database.getActorFromId({ id: aliasId })
      return {
        id: aliasId,
        acct: row ? `${row.username}@${row.domain}` : null
      }
    })
  )
  const migration = await getMigrationState(database, actor)
  const hasPassword = Boolean(actor.account.passwordHash)

  // The newest migration row that names the current pointer tells a redirect
  // (cancellable) from a performed move (not). A pointer with no row is a
  // legacy move and is never offered a cancel.
  const movedTo = migration.movedTo
  const currentMigration =
    movedTo !== null
      ? (migration.migrations.find(
          (entry) => entry.targetActorId === movedTo.id
        ) ?? null)
      : null
  const movedKind = movedTo !== null ? (currentMigration?.kind ?? 'move') : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Moving"
        description="Change your handle, or move to another account. Mastodon calls this account migration."
      />

      <Alert
        tone="info"
        live={false}
        title={`These settings are for @${handle.acct}`}
      />

      {movedKind === 'move' ? null : (
        <Section
          title="Change your handle"
          description="Pick a new username or domain. Everything you posted stays with you."
        >
          {movedKind === 'redirect' ? (
            <p className="text-muted-foreground text-sm">
              Changing your handle and moving are off while your profile shows
              as moved. Cancel the redirect to use them again.
            </p>
          ) : (
            <HandleRenameForm
              actorId={actor.id}
              hasPassword={hasPassword}
              initialHandle={handle}
            />
          )}
        </Section>
      )}

      <Section
        title="Moving from another account"
        description="Moving into this profile from another account? Add the old handle here first so the other server lets you move."
      >
        <AliasesSection actorId={actor.id} initialAliases={aliases} />
      </Section>

      {movedTo !== null ? (
        <MovedNotice
          actorId={actor.id}
          acct={movedTo.acct}
          kind={movedKind ?? 'move'}
          movedAt={currentMigration?.createdAt ?? null}
          cooldownUntil={migration.cooldownUntil}
        />
      ) : (
        <Section
          title="Move to another account"
          description="Send your followers to a different account, on this server or another one."
        >
          <MoveForm
            actorId={actor.id}
            hasPassword={hasPassword}
            currentHandle={handle.acct}
            cooldownUntil={migration.cooldownUntil}
          />
        </Section>
      )}
    </div>
  )
}

export default Page

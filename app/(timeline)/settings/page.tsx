import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { getProviders } from 'next-auth/react'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { Button } from '@/lib/components/Button'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getActorProfile } from '@/lib/models/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { AuthenticationProviders } from './AuthenticationProviders'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Settings'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const [session, providers] = await Promise.all([
    getServerSession(getAuthOptions()),
    getProviders()
  ])

  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect(`https://${getConfig().host}/auth/signin`)
  }

  const profile = getActorProfile(actor)
  const nonCredentialsProviders =
    (providers &&
      Object.values(providers).filter(
        (provider) => provider.id !== 'credentials'
      )) ||
    []
  return (
    <div>
      <form action="/api/v1/accounts/profile" method="post">
        <div className="mb-3">
          <label htmlFor="nameInput" className="form-label">
            Name
          </label>
          <input
            type="text"
            className="form-control"
            id="nameInput"
            name="name"
            aria-describedby="nameHelp"
            defaultValue={profile.name}
          />
          <div id="nameHelp" className="form-text">
            Name that you want to show in profile
          </div>
        </div>
        <div className="mb-3">
          <label htmlFor="summaryInput" className="form-label">
            Summary
          </label>
          <textarea
            rows={3}
            className="form-control"
            name="summary"
            id="summaryInput"
            defaultValue={profile.summary || ''}
          />
        </div>
        <div className="mb-3">
          <label htmlFor="iconInput" className="form-label">
            Icon Image URL
          </label>
          <input
            type="text"
            className="form-control"
            name="iconUrl"
            id="iconInput"
            aria-describedby="iconHelp"
            defaultValue={profile.iconUrl}
          />
          <div id="iconHelp" className="form-text">
            Image URL for profile
          </div>
        </div>
        <div className="mb-3">
          <label htmlFor="headerImageInput" className="form-label">
            Header Image URL
          </label>
          <input
            type="text"
            className="form-control"
            id="headerImageInput"
            name="headerImageUrl"
            aria-describedby="headerImageHelp"
            defaultValue={profile.headerImageUrl}
          />
          <div id="headerImageHelp" className="form-text">
            Image URL for profile header
          </div>
        </div>
        <hr />
        <div className="mb-3">
          <label htmlFor="appleSharedAlbumTokenInput" className="form-label">
            Apple Shared albums contains medias that you want to post with
          </label>
          <input
            type="text"
            className="form-control"
            id="appleSharedAlbumTokenInput"
            name="appleSharedAlbumToken"
            aria-describedby="appleSharedAlbumTokenHelp"
            defaultValue={profile.appleSharedAlbumToken}
          />
          <div id="appleSharedAlbumTokenHelp" className="form-text">
            Apple Shared Album tokens contains images (and videos) that you want
            to post with
          </div>
        </div>

        <Button type="submit" variant="primary">
          Update
        </Button>
      </form>
      <AuthenticationProviders
        nonCredentialsProviders={nonCredentialsProviders}
      />
    </div>
  )
}

export default Page

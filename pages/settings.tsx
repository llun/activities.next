/* eslint-disable camelcase */
import cn from 'classnames'
import {
  GetServerSidePropsContext,
  InferGetServerSidePropsType,
  NextPage
} from 'next'
import { getServerSession } from 'next-auth/next'
import { getProviders, signIn, useSession } from 'next-auth/react'
import Head from 'next/head'
import Image from 'next/image'
import Link from 'next/link'

import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'
import { Profile as ProfileComponent } from '../lib/components/Profile'
import { getConfig } from '../lib/config'
import { Actor } from '../lib/models/actor'
import { getStorage } from '../lib/storage'
import { authOptions } from './api/auth/[...nextauth]'
import styles from './settings.module.scss'

export async function getServerSideProps({
  req,
  res
}: GetServerSidePropsContext) {
  const [storage, session, providers] = await Promise.all([
    getStorage(),
    getServerSession(req, res, authOptions),
    getProviders()
  ])

  const config = getConfig()
  if (
    !session?.user?.email ||
    !config.allowEmails.includes(session?.user?.email || '') ||
    !storage
  ) {
    return {
      redirect: {
        destination: '/auth/signin',
        permanent: false
      }
    }
  }

  const actor = await storage.getActorFromEmail({ email: session.user.email })
  if (!actor) {
    return {
      redirect: {
        destination: '/auth/signin',
        permanent: false
      }
    }
  }

  return {
    props: {
      profile: actor.toProfile(),
      providers
    }
  }
}

const Page: NextPage<
  InferGetServerSidePropsType<typeof getServerSideProps>
> = ({ profile, providers }) => {
  const { data: session } = useSession()
  const nonCredentialsProviders =
    (providers &&
      Object.values(providers).filter(
        (provider) => provider.id !== 'credentials'
      )) ||
    []

  return (
    <main>
      <Head>
        <title>Activities: Settings</title>
      </Head>
      <Header session={session} />
      <section className="container pt-4">
        <div className="row">
          <div className="col-12 col-md-3">
            {profile.iconUrl && (
              <Image
                width={100}
                height={100}
                alt="Actor icon"
                className={cn(styles.icon, 'me-4', 'mb-2', 'flex-shrink-0')}
                src={profile.iconUrl}
              />
            )}
            <ProfileComponent
              name={profile.name || ''}
              url={`https://${profile.domain}/${Actor.getMentionFromProfile(
                profile
              )}`}
              username={profile.username}
              domain={profile.domain}
              createdAt={profile.createdAt}
            />
            <ul>
              <li>
                <Link href="/settings" prefetch={false}>
                  Profile
                </Link>
              </li>
              <li>
                <Link href="/settings/sessions" prefetch={false}>
                  Sessions
                </Link>
              </li>
            </ul>
          </div>
          <div className="col-12 col-md-9">
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
                <label
                  htmlFor="appleSharedAlbumTokenInput"
                  className="form-label"
                >
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
                  Apple Shared Album tokens contains images (and videos) that
                  you want to post with
                </div>
              </div>

              <Button type="submit" variant="primary">
                Update
              </Button>
            </form>
            {nonCredentialsProviders.length && (
              <div>
                <hr />
                {nonCredentialsProviders.map((provider) => (
                  <div key={provider.name} className="mb-2">
                    <Button onClick={() => signIn(provider.id)}>
                      Connect to {provider.name}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

export default Page

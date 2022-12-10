/* eslint-disable camelcase */
import cn from 'classnames'
import { GetServerSideProps, NextPage } from 'next'
import { unstable_getServerSession } from 'next-auth/next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import Image from 'next/image'

import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'
import { getConfig } from '../lib/config'
import {
  Profile,
  getProfileFromActor,
  getUsernameFromId
} from '../lib/models/actor'
import { getStorage } from '../lib/storage'
import { authOptions } from './api/auth/[...nextauth]'
import styles from './profile.module.scss'

interface Props {
  profile: Profile
}

const Page: NextPage<Props> = ({ profile }) => {
  const { data: session } = useSession()

  return (
    <main>
      <Head>
        <title>Activities: profile</title>
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
            <div>
              <h1>{profile.name}</h1>
              <h4>@{getUsernameFromId(profile.id)}</h4>
              {Number.isInteger(profile.createdAt) && (
                <p>
                  Joined{' '}
                  {new Intl.DateTimeFormat('en-US', {
                    dateStyle: 'long',
                    timeStyle: 'short'
                  }).format(new Date(profile.createdAt))}
                </p>
              )}
            </div>
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
          </div>
        </div>
      </section>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  req,
  res
}) => {
  const [storage, session] = await Promise.all([
    getStorage(),
    unstable_getServerSession(req, res, authOptions)
  ])

  const config = getConfig()
  if (
    !session?.user?.email ||
    !config.allowEmails.includes(session?.user?.email || '') ||
    !storage
  ) {
    return {
      redirect: {
        destination: '/signin',
        permanent: false
      }
    }
  }

  const actor = await storage.getActorFromEmail({ email: session.user.email })
  if (!actor) {
    return {
      redirect: {
        destination: '/signin',
        permanent: false
      }
    }
  }

  return {
    props: {
      profile: getProfileFromActor(actor)
    }
  }
}

export default Page

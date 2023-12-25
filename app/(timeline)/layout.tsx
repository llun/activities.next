import 'bootstrap-icons/font/bootstrap-icons.css'
import 'bootstrap/dist/css/bootstrap.css'
import cn from 'classnames'
import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { FC, ReactNode } from 'react'

import { Header } from '@/lib/components/Header'
import { Profile as ProfileComponent } from '@/lib/components/Profile'
import { Actor } from '@/lib/models/actor'
import { getStorage } from '@/lib/storage'

import { Modal } from '../Modal'
import { authOptions } from '../api/auth/[...nextauth]/authOptions'
import styles from './(timeline).module.scss'
import { getActorFromSession } from './getActorFromSession'

export const viewport = {
  width: 'device-width',
  initialScale: 1
}

export const metadata: Metadata = {
  title: 'Activities.next'
}

interface LayoutProps {
  children: ReactNode
}

const Layout: FC<LayoutProps> = async ({ children }) => {
  const [storage, session] = await Promise.all([
    getStorage(),
    getServerSession(authOptions)
  ])

  if (!storage) {
    throw new Error('Fail to load storage')
  }

  const actor = await getActorFromSession(storage, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  const profile = actor.toProfile()
  return (
    <html lang="en">
      <body>
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
            </div>
            <div className="col-12 col-md-9">{children}</div>
          </div>
        </section>
        <Modal />
      </body>
    </html>
  )
}

export default Layout

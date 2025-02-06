import 'bootstrap-icons/font/bootstrap-icons.css'
import 'bootstrap/dist/css/bootstrap.css'
import cn from 'classnames'
import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { FC, ReactNode } from 'react'

import { Modal } from '@/app/Modal'
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { Header } from '@/lib/components/Header'
import { Profile as ProfileComponent } from '@/lib/components/Profile'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getActorProfile, getMention } from '@/lib/models/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import styles from './(timeline).module.scss'

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
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerSession(getAuthOptions())
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect(`https://${getConfig().host}/auth/signin`)
  }

  const profile = getActorProfile(actor)
  return (
    <html lang="en">
      <body className="">
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
                url={`https://${profile.domain}/${getMention(profile)}`}
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

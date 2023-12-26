import cn from 'classnames'
import { FC, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

const Layout: FC<Props> = ({ children }) => {
  const tabs = [
    { name: 'settings', url: '/settings' },
    { name: 'sessions', url: '/settings/sessions' }
  ]

  return (
    <>
      <ul className={cn('nav', 'mt-4')}>
        <li className="nav-item">
          <a className="nav-link disabled">Links</a>
        </li>
        {tabs.map((tab) => (
          <li key={tab.name} className="nav-item">
            <a href={tab.url} className={cn('nav-link')}>
              {tab.name}
            </a>
          </li>
        ))}
      </ul>
      <hr />
      {children}
    </>
  )
}

export default Layout

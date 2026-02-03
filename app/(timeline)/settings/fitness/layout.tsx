'use client'

import { FC, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

const Layout: FC<Props> = ({ children }) => {
  return <div className="space-y-6">{children}</div>
}

export default Layout

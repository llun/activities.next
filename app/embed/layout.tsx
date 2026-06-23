import { Metadata } from 'next'
import { FC, ReactNode } from 'react'

// Chrome-less, full-viewport shell for embeddable widgets. It sits directly
// under the root layout (which only renders <html>/<body>), so it inherits none
// of the app navigation. Public embeds are not search-indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false }
}

interface EmbedLayoutProps {
  children: ReactNode
}

const EmbedLayout: FC<EmbedLayoutProps> = ({ children }) => (
  <div className="h-dvh w-full overflow-hidden bg-background">{children}</div>
)

export default EmbedLayout

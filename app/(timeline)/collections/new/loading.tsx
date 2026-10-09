import { FC } from 'react'

import { EditorLoading } from '@/app/(timeline)/EditorLoading'

const Loading: FC = () => (
  <EditorLoading label="Loading collection editor" sections={[5]} />
)

export default Loading

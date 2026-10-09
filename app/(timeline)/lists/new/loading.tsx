import { FC } from 'react'

import { EditorLoading } from '@/app/(timeline)/EditorLoading'

const Loading: FC = () => (
  <EditorLoading label="Loading list editor" sections={[3]} />
)

export default Loading

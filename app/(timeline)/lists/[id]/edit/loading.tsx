import { FC } from 'react'

import { EditorLoading } from '@/app/(timeline)/EditorLoading'

const Loading: FC = () => (
  <EditorLoading label="Loading list editor" sections={[3, 4, 1]} />
)

export default Loading

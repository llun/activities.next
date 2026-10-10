/** The strings of the Masks tab, in one place so the panels and tests agree. */
export const MASK_COPY = {
  tab: 'Masks',
  empty: 'No masks yet. Select the subject, or paint a brush mask.',
  emptyBrushOnly: 'No masks yet. Paint a brush mask.',
  selectSubject: 'Select subject',
  background: 'Background',
  brush: 'Brush',
  newMask: 'New mask',
  limit: 'You can use up to 4 masks.',
  needSubject: 'Select a subject first, then add its background.',
  refine: 'Refine',
  add: 'Add',
  remove: 'Remove',
  feather: 'Feather',
  brushSize: 'Brush size',
  brushPaint: 'Paint',
  brushErase: 'Erase',
  overlay: 'Overlay',
  remove_mask: 'Remove mask',
  backgroundFollows:
    'The background follows the subject. Select the subject to refine it.',
  downloading: (size: string) =>
    `Downloading the subject model (${size}, once)`,
  preparing: 'Getting the subject model ready',
  working: 'Finding the subject',
  modelFailed: "Couldn't load the subject model.",
  modelChecksum: "The subject model download didn't check out. Try again.",
  segmentFailed: "Couldn't find the subject. Try again.",
  stageHintSubject: 'Subject · tap to refine',
  stageHintBackground: 'Background · follows the subject',
  stageHintBrush: 'Brush · paint on the photo',
  stageHintPending: 'Select a mask to refine it'
} as const

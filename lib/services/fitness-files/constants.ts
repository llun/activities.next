// Maximum file size is 50 MB for fitness files
export const MAX_FITNESS_FILE_SIZE = 52_428_800

// Accepted fitness file types
export const ACCEPTED_FITNESS_FILE_TYPES = [
  'application/vnd.ant.fit', // .fit files
  'application/fit',
  'application/octet-stream', // Generic binary, may be .fit
  'application/gpx+xml', // .gpx files
  'application/xml', // .gpx may also be plain xml
  'text/xml', // .gpx alternative
  'application/tcx+xml', // .tcx files
  'application/vnd.garmin.tcx+xml'
]

// File extensions
export const ACCEPTED_FITNESS_FILE_EXTENSIONS = ['.fit', '.gpx', '.tcx']

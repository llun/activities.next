// Names a non-browser client can put in the multipart `filename` parameter or
// the presigned request's `fileName` field. Both storage drivers reduce a
// supplied name the same way, so they are held to one table rather than a copy
// each — the copies drifted apart the first time they existed.
export const STORED_FITNESS_FILE_NAME_CASES = [
  {
    description: 'strips a POSIX directory prefix',
    fileName: '../../../etc/cron.d/ride.gpx',
    expected: 'ride.gpx'
  },
  {
    description: 'strips a Windows directory prefix',
    fileName: `..${String.fromCharCode(92)}..${String.fromCharCode(92)}ride.gpx`,
    expected: 'ride.gpx'
  },
  {
    description: 'strips a NUL byte',
    fileName: `ride.gpx${String.fromCharCode(0)}.exe`,
    expected: 'ride.gpx.exe'
  },
  {
    description: 'strips a bidi override that disguises the name',
    fileName: `ride${String.fromCharCode(0x202e)}xpg.gpx`,
    expected: 'ridexpg.gpx'
  },
  {
    description: 'falls back when the name is a parent reference',
    fileName: '..',
    expected: 'file'
  },
  {
    description: 'falls back when the name is a current-directory reference',
    fileName: '.',
    expected: 'file'
  },
  {
    description: 'keeps an ordinary name unchanged',
    fileName: 'Morning Ride.gpx',
    expected: 'Morning Ride.gpx'
  }
]

// Sanitizing yields exactly the first 200 bytes, dropping the extension. The
// tests assert that literal rather than a `<= 200` bound, which any truncation
// — including a catastrophic one — would satisfy.
export const OVER_LONG_FITNESS_FILE_NAME = `${'a'.repeat(500)}.gpx`
export const OVER_LONG_FITNESS_FILE_NAME_TRUNCATED = 'a'.repeat(200)

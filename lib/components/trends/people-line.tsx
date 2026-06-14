// "{n} people in the past 2 days" — the shared subtitle across every trend
// surface. Always counts distinct people, never raw post/use counts.
export const PeopleLine = ({ people }: { people: number }) => (
  <div className="text-[13px] text-muted-foreground">
    {people} {people === 1 ? 'person' : 'people'} in the past 2 days
  </div>
)

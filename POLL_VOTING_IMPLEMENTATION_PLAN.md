# Poll Voting Implementation Plan

## Executive Summary

This document outlines the complete implementation plan for adding poll voting functionality to the Activities.next platform. Currently, users can create and view polls, but cannot vote on them. This plan covers the full end-to-end implementation including backend APIs, database operations, UI components, and comprehensive test coverage.

---

## Current State Analysis

### ✅ What Already Works

1. **Poll Creation**
   - UI component for creating polls with 2-5 choices
   - Duration selector (5 minutes to 7 days)
   - Backend API endpoint: `POST /api/v1/accounts/outbox`
   - Database persistence for poll questions and choices
   - Integration with timelines and visibility settings

2. **Poll Display**
   - Poll component shows choices with vote counts and percentages
   - Visual progress bars for each option
   - Poll expiration status (open/closed)
   - Countdown timer using date-fns
   - Mastodon API compatibility layer

3. **Data Models**
   - `StatusPoll` type with choices, endAt, etc.
   - `PollChoice` model with totalVotes tracking
   - `poll_choices` table fully implemented
   - `poll_answers` table exists but **UNUSED**

### ❌ What's Missing

1. **Voting API Endpoint**
   - No `POST /api/v1/polls/[id]/votes` endpoint
   - No backend vote processing logic
   - No vote validation (expiration check, duplicate prevention)

2. **Vote Persistence**
   - `poll_answers` table created but never used
   - No database methods for:
     - Recording votes
     - Checking existing votes
     - Retrieving user's votes
     - Updating vote counts

3. **Interactive UI**
   - Radio buttons are **disabled** in Poll component
   - No vote submission handlers
   - No loading/error states
   - No optimistic updates

4. **User Context**
   - Mastodon API fields hardcoded:
     - `voted: false` (always)
     - `own_votes: []` (always empty)
   - No tracking of which user voted for which option

5. **ActivityPub Integration**
   - `Question.oneOf` field always empty
   - No Answer activity generation
   - No incoming vote processing

---

## Implementation Plan

### Phase 1: Database Layer

#### 1.1 Poll Answer Database Methods
**File:** `/lib/database/sql/pollAnswer.ts` (NEW)

Create comprehensive database operations:

```typescript
// Core operations
- createPollAnswer(actorId, choiceId)
- getActorPollAnswers(actorId, statusId)
- deletePollAnswer(actorId, choiceId)
- hasActorVotedOnPoll(actorId, statusId)
- getPollAnswersByStatus(statusId)
- getPollAnswersByChoice(choiceId)
```

**Database Schema:**
```sql
poll_answers (
  answerId TEXT PRIMARY KEY,
  choice TEXT (references poll_choices.choiceId),
  actorId TEXT (references actors.id),
  createdAt INTEGER,
  updatedAt INTEGER
)
```

**Constraints:**
- Unique constraint on (actorId, choice) to prevent duplicate votes
- Foreign key constraints for data integrity
- Indexes on actorId and choice for performance

#### 1.2 Update Poll Choice Vote Counts
**File:** `/lib/database/sql/status.ts`

Add method:
```typescript
- incrementPollChoiceVotes(choiceId)
- decrementPollChoiceVotes(choiceId)
- recalculatePollVoteCounts(statusId) // For consistency checks
```

**Tests Required:**
- ✅ Create poll answer successfully
- ✅ Prevent duplicate votes (same actor, same choice)
- ✅ Allow multiple votes on different choices (multi-choice polls, future)
- ✅ Retrieve actor's votes for a poll
- ✅ Check if actor has voted
- ✅ Delete vote and decrement count
- ✅ Vote count increments correctly
- ✅ Handle non-existent polls/choices gracefully
- ✅ Transaction safety (vote + count update atomic)

---

### Phase 2: API Endpoints

#### 2.1 Vote Submission Endpoint
**File:** `/app/api/v1/polls/[id]/votes/route.ts` (NEW)

**Endpoint:** `POST /api/v1/polls/:id/votes`

**Request Body:**
```json
{
  "choices": [0]  // Array of choice indices (0-based)
}
```

**Response:** Mastodon.Poll object with updated counts

**Validation:**
1. Poll exists
2. Poll not expired
3. User authenticated
4. Choice indices valid
5. User hasn't already voted (single-choice polls)
6. For future: Respect multiple choice setting

**Error Responses:**
- `404` - Poll not found
- `401` - Not authenticated
- `422` - Poll expired / Invalid choice / Already voted
- `500` - Server error

**Implementation Steps:**
1. Validate poll ID and get poll data
2. Check poll expiration: `endAt > Date.now()`
3. Verify choice index within bounds
4. Check if actor already voted (for single-choice)
5. Create poll answer record
6. Increment vote count for choice
7. Return updated poll with user's vote context

#### 2.2 Delete Vote Endpoint (Optional)
**File:** `/app/api/v1/polls/[id]/votes/route.ts` (NEW)

**Endpoint:** `DELETE /api/v1/polls/:id/votes`

Allow users to remove their vote before poll closes.

**Tests Required:**
- ✅ Vote successfully on valid poll
- ✅ Return 404 for non-existent poll
- ✅ Return 422 for expired poll
- ✅ Return 422 for invalid choice index
- ✅ Return 422 when already voted (single-choice)
- ✅ Return 401 for unauthenticated requests
- ✅ Vote count increments correctly
- ✅ Response includes updated poll with voted: true
- ✅ Response includes own_votes array
- ✅ Delete vote successfully
- ✅ Vote count decrements on delete
- ✅ Can re-vote after deleting (future enhancement)

---

### Phase 3: Mastodon API Compatibility

#### 3.1 Update Poll Serialization
**File:** `/lib/services/mastodon/getMastodonStatus.ts`

**Current Implementation:**
```typescript
voted: false,  // Always false
own_votes: []  // Always empty
```

**New Implementation:**
```typescript
// Check if current actor has voted
const actorVotes = await getActorPollAnswers(actorId, statusId);
const hasVoted = actorVotes.length > 0;
const ownVoteIndices = actorVotes.map(vote =>
  poll.choices.findIndex(c => c.choiceId === vote.choice)
);

return {
  ...poll,
  voted: hasVoted,
  own_votes: ownVoteIndices
};
```

**Parameters:**
- Accept optional `actorId` parameter to getMastodonStatus()
- If no actorId (public view), return voted: false

**Tests Required:**
- ✅ `voted: false` when actor hasn't voted
- ✅ `voted: true` when actor has voted
- ✅ `own_votes` contains correct choice indices
- ✅ `own_votes: []` when actor hasn't voted
- ✅ Public view (no actorId) returns voted: false
- ✅ Vote counts include all votes from all users
- ✅ Percentages calculated correctly

---

### Phase 4: UI Components

#### 4.1 Interactive Poll Component
**File:** `/lib/components/posts/poll.tsx`

**Current State:**
- Radio buttons disabled
- No click handlers
- Static vote display

**New Implementation:**

**Features:**
1. Enable radio buttons for open polls
2. Disable for closed/voted polls
3. Loading state during vote submission
4. Error handling with toast notifications
5. Optimistic UI updates
6. Vote button to submit selection

**Component State:**
```typescript
const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
const [isVoting, setIsVoting] = useState(false);
const [hasVoted, setHasVoted] = useState(poll.voted);
const [localVotes, setLocalVotes] = useState(poll.options);
```

**Vote Submission Handler:**
```typescript
async function handleVote() {
  if (!selectedChoice) return;

  setIsVoting(true);

  try {
    // Optimistic update
    const newOptions = updateVoteCounts(poll.options, selectedChoice);
    setLocalVotes(newOptions);
    setHasVoted(true);

    // API call
    const response = await fetch(`/api/v1/polls/${poll.id}/votes`, {
      method: 'POST',
      body: JSON.stringify({ choices: [selectedChoice] })
    });

    if (!response.ok) throw new Error('Vote failed');

    const updatedPoll = await response.json();
    // Update with real data
    setLocalVotes(updatedPoll.options);

  } catch (error) {
    // Revert optimistic update
    setLocalVotes(poll.options);
    setHasVoted(false);
    toast.error('Failed to vote');
  } finally {
    setIsVoting(false);
  }
}
```

**UI States:**
1. **Can Vote:** Open poll, not voted yet
   - Show enabled radio buttons
   - Show "Vote" button
   - Highlight selected option

2. **Already Voted:** User has voted
   - Show disabled radio buttons
   - Highlight user's choice with checkmark
   - Show vote counts and percentages

3. **Poll Closed:** Past expiration time
   - Show disabled radio buttons
   - Show final results
   - Display "Poll ended" status

4. **Loading:** Vote in progress
   - Show spinner on Vote button
   - Disable radio buttons
   - Show optimistic vote count

**Accessibility:**
- Proper ARIA labels for radio buttons
- Keyboard navigation support
- Screen reader announcements for vote success/error
- Focus management

#### 4.2 Client API Method
**File:** `/lib/client.ts`

Add method:
```typescript
export async function votePoll(
  pollId: string,
  choices: number[]
): Promise<Mastodon.Poll> {
  const response = await fetch(`/api/v1/polls/${pollId}/votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ choices })
  });

  if (!response.ok) {
    throw new Error(`Vote failed: ${response.status}`);
  }

  return response.json();
}
```

**Tests Required:**
- ✅ Radio buttons enabled for open polls
- ✅ Radio buttons disabled for closed polls
- ✅ Radio buttons disabled after voting
- ✅ Selected choice highlights on click
- ✅ Vote button appears when choice selected
- ✅ Vote button disabled during submission
- ✅ Loading spinner shows during vote
- ✅ Optimistic UI update on vote
- ✅ Vote counts update after successful vote
- ✅ Error toast shows on failed vote
- ✅ Reverts optimistic update on error
- ✅ User's choice marked with checkmark after voting
- ✅ Keyboard navigation works
- ✅ Screen reader announces vote success/error

---

### Phase 5: Server Actions

#### 5.1 Vote Poll Action
**File:** `/lib/actions/votePoll.ts` (NEW)

Server action for Next.js server components:

```typescript
'use server'

export async function votePoll(
  pollId: string,
  choiceIndex: number
): Promise<ActionResult<Mastodon.Poll>> {
  const session = await getSession();
  if (!session) {
    return { error: 'Not authenticated' };
  }

  try {
    const poll = await getPollById(pollId);
    if (!poll) {
      return { error: 'Poll not found' };
    }

    if (poll.endAt < Date.now()) {
      return { error: 'Poll has ended' };
    }

    const choice = poll.choices[choiceIndex];
    if (!choice) {
      return { error: 'Invalid choice' };
    }

    const hasVoted = await hasActorVotedOnPoll(session.actorId, pollId);
    if (hasVoted) {
      return { error: 'Already voted on this poll' };
    }

    await createPollAnswer(session.actorId, choice.choiceId);
    await incrementPollChoiceVotes(choice.choiceId);

    const updatedPoll = await getPollById(pollId);
    const mastodonPoll = await getMastodonPoll(updatedPoll, session.actorId);

    return { data: mastodonPoll };

  } catch (error) {
    return { error: 'Failed to vote' };
  }
}
```

**Tests Required:**
- ✅ Vote successfully with valid data
- ✅ Return error for unauthenticated user
- ✅ Return error for non-existent poll
- ✅ Return error for expired poll
- ✅ Return error for invalid choice index
- ✅ Return error when already voted
- ✅ Return updated poll with vote counts
- ✅ Atomic transaction (vote + count update)

---

### Phase 6: Integration Testing

#### 6.1 End-to-End Flow Tests
**File:** `/lib/__tests__/poll-voting.test.ts` (NEW)

**Test Scenarios:**

1. **Complete Voting Flow**
   - User views timeline with poll
   - User selects a choice
   - User clicks Vote button
   - Vote is recorded
   - UI updates with new counts
   - User sees their vote highlighted

2. **Multiple Users Voting**
   - User A votes for option 1
   - User B votes for option 2
   - Both see correct vote counts
   - User A sees only their vote highlighted
   - Total vote count increments correctly

3. **Poll Expiration**
   - User attempts to vote on expired poll
   - API returns 422 error
   - UI shows "Poll ended" message
   - Radio buttons disabled

4. **Duplicate Vote Prevention**
   - User votes once
   - User attempts to vote again
   - API returns 422 error
   - UI remains in "voted" state

5. **Optimistic UI Update**
   - User clicks Vote
   - UI immediately updates (optimistic)
   - If API fails, UI reverts
   - Error message shown

6. **Poll Creation and Voting**
   - User A creates poll with 3 options
   - Poll appears in timeline
   - User B votes on option 2
   - User A sees vote count increase
   - User A can vote on their own poll

#### 6.2 Component Tests
**File:** `/lib/components/posts/__tests__/poll.test.tsx`

**Test Cases:**
- ✅ Renders poll with choices
- ✅ Shows vote counts and percentages
- ✅ Shows expiration time
- ✅ Radio buttons enabled for open polls
- ✅ Radio buttons disabled for closed polls
- ✅ Vote button appears when choice selected
- ✅ Calls votePoll on button click
- ✅ Shows loading state during vote
- ✅ Updates UI after successful vote
- ✅ Shows error on failed vote
- ✅ Highlights user's choice after voting
- ✅ Shows "Poll ended" for expired polls

#### 6.3 API Route Tests
**File:** `/app/api/v1/polls/[id]/votes/__tests__/route.test.ts`

**Test Cases:**
- ✅ POST returns 201 with updated poll
- ✅ POST returns 404 for invalid poll ID
- ✅ POST returns 422 for expired poll
- ✅ POST returns 422 for invalid choice
- ✅ POST returns 422 for duplicate vote
- ✅ POST returns 401 for unauthenticated
- ✅ Vote count increments correctly
- ✅ Response includes voted: true
- ✅ Response includes own_votes array

#### 6.4 Database Tests
**File:** `/lib/database/sql/__tests__/pollAnswer.test.ts`

**Test Cases:**
- ✅ createPollAnswer inserts record
- ✅ createPollAnswer prevents duplicates
- ✅ getActorPollAnswers returns votes
- ✅ hasActorVotedOnPoll returns true/false
- ✅ deletePollAnswer removes record
- ✅ incrementPollChoiceVotes updates count
- ✅ Transaction rollback on error

---

## Test Coverage Requirements

### Minimum Coverage Targets

- **Database Layer:** 100% coverage
  - All CRUD operations tested
  - Edge cases (duplicates, non-existent records)
  - Transaction safety

- **API Endpoints:** 100% coverage
  - All success paths
  - All error conditions (404, 401, 422, 500)
  - Request validation
  - Response format

- **UI Components:** 95% coverage
  - All UI states (can vote, voted, closed)
  - User interactions (click, select, submit)
  - Loading and error states
  - Optimistic updates

- **Server Actions:** 100% coverage
  - All business logic paths
  - All error conditions
  - Session validation

### Test Tools

- **Unit Tests:** Jest + React Testing Library
- **Integration Tests:** Supertest for API routes
- **E2E Tests:** Playwright (if available)
- **Database Tests:** SQLite in-memory database

---

## Implementation Order

### Week 1: Foundation
1. ✅ Database layer (`pollAnswer.ts`)
2. ✅ Database tests (100% coverage)
3. ✅ Vote count increment/decrement methods
4. ✅ Database integration tests

### Week 2: API Layer
5. ✅ API endpoint (`/api/v1/polls/[id]/votes/route.ts`)
6. ✅ API endpoint tests (100% coverage)
7. ✅ Server action (`votePoll.ts`)
8. ✅ Server action tests (100% coverage)

### Week 3: Mastodon Compatibility
9. ✅ Update `getMastodonStatus` to include vote context
10. ✅ Tests for vote context in API responses
11. ✅ Client API method (`votePoll` in `client.ts`)

### Week 4: UI Implementation
12. ✅ Update Poll component with interactive UI
13. ✅ Add vote submission handler
14. ✅ Implement optimistic UI updates
15. ✅ Add loading and error states
16. ✅ Component tests (95% coverage)

### Week 5: Integration & Testing
17. ✅ End-to-end integration tests
18. ✅ Multi-user voting scenarios
19. ✅ Poll expiration handling
20. ✅ Error handling and edge cases

### Week 6: Polish & Documentation
21. ✅ Accessibility improvements
22. ✅ Performance optimization
23. ✅ Documentation updates
24. ✅ Final testing and bug fixes

---

## Success Criteria

### Functional Requirements
- ✅ Users can vote on polls in their timeline
- ✅ Vote counts update in real-time
- ✅ Users cannot vote twice on single-choice polls
- ✅ Users cannot vote on expired polls
- ✅ User's vote is visually indicated
- ✅ Vote percentages calculated correctly
- ✅ Polls show accurate "X votes" count

### Technical Requirements
- ✅ 100% test coverage on database layer
- ✅ 100% test coverage on API endpoints
- ✅ 100% test coverage on server actions
- ✅ 95% test coverage on UI components
- ✅ All tests passing
- ✅ No TypeScript errors
- ✅ No ESLint warnings

### User Experience Requirements
- ✅ Vote submission < 500ms (optimistic UI)
- ✅ Clear visual feedback for voting states
- ✅ Error messages are user-friendly
- ✅ Keyboard navigation fully supported
- ✅ Screen reader accessible
- ✅ Mobile-responsive design

### Mastodon API Compatibility
- ✅ Poll object matches Mastodon spec
- ✅ `voted` field accurate
- ✅ `own_votes` array populated correctly
- ✅ Vote counts match database
- ✅ Compatible with Mastodon clients

---

## Risk Mitigation

### Technical Risks

**Risk:** Race condition on simultaneous votes
- **Mitigation:** Database unique constraint + transaction isolation
- **Fallback:** Return 422 on duplicate vote attempt

**Risk:** Vote count inconsistency
- **Mitigation:** Atomic increment in same transaction as vote creation
- **Fallback:** Recalculation method to fix inconsistencies

**Risk:** Poll expiration edge cases (timezone issues)
- **Mitigation:** Store timestamps in UTC, use server time for validation
- **Fallback:** Client-side check + server-side check

**Risk:** Optimistic UI update fails to sync
- **Mitigation:** Revert on error + retry mechanism
- **Fallback:** Full page refresh to get latest state

### Testing Risks

**Risk:** Insufficient coverage of edge cases
- **Mitigation:** Comprehensive test plan with specific edge cases listed
- **Fallback:** Add tests as edge cases discovered in QA

**Risk:** Integration tests don't cover real user flows
- **Mitigation:** E2E tests simulate actual user interactions
- **Fallback:** Manual QA testing before release

---

## Future Enhancements

### Phase 7: Advanced Features (Post-MVP)

1. **Multiple Choice Polls**
   - Allow selecting multiple options
   - Update UI with checkboxes instead of radio buttons
   - Update validation logic

2. **Vote Deletion**
   - Allow users to remove their vote
   - Implement DELETE endpoint
   - Update UI with "Remove vote" option

3. **Real-time Updates**
   - WebSocket support for live vote count updates
   - Other users' votes appear without refresh
   - Optimistic updates for all users

4. **ActivityPub Integration**
   - Generate Answer activities for votes
   - Process incoming vote activities from federated servers
   - Update `Question.oneOf` field

5. **Poll Analytics**
   - View who voted for what (for poll creator)
   - Export poll results
   - Historical vote tracking

6. **Anonymous Polls**
   - Option to hide voter identities
   - Only show aggregate counts
   - Privacy controls

---

## Dependencies

### External Libraries
- ✅ `date-fns` (already in use for date handling)
- ✅ `react-hook-form` (if needed for form validation)
- ✅ `@testing-library/react` (for component tests)
- ✅ `jest` (for unit tests)

### Internal Dependencies
- ✅ Session management (existing)
- ✅ Database layer (existing)
- ✅ Mastodon API compatibility layer (existing)
- ✅ Timeline components (existing)
- ✅ Post components (existing)

---

## Rollout Plan

### Phase 1: Internal Testing
- Deploy to staging environment
- Run full test suite
- Manual QA testing
- Fix critical bugs

### Phase 2: Beta Release
- Enable for subset of users
- Monitor error rates
- Collect user feedback
- Performance monitoring

### Phase 3: General Availability
- Enable for all users
- Monitor vote counts and engagement
- Track error rates
- Gather analytics

### Phase 4: Iteration
- Address user feedback
- Optimize performance
- Add polish features
- Plan advanced features

---

## Conclusion

This implementation plan provides a comprehensive roadmap for adding poll voting functionality to Activities.next. The phased approach ensures:

1. **Solid Foundation:** Database layer first, with 100% test coverage
2. **API Reliability:** Well-tested endpoints with proper error handling
3. **Great UX:** Responsive, accessible UI with optimistic updates
4. **Quality Assurance:** Comprehensive testing at every layer
5. **Future-Ready:** Architecture supports advanced features

The estimated timeline is 6 weeks with daily incremental progress. Each phase builds on the previous, allowing for early detection of issues and course correction.

**Total Estimated Effort:** 6 weeks
**Test Coverage Target:** 98% overall
**Success Metric:** Users can successfully vote on polls with < 1% error rate

---

## Appendix A: File Structure

```
/lib/
  ├── actions/
  │   └── votePoll.ts (NEW)
  ├── database/sql/
  │   ├── pollAnswer.ts (NEW)
  │   ├── status.ts (UPDATE - add vote count methods)
  │   └── __tests__/
  │       └── pollAnswer.test.ts (NEW)
  ├── services/mastodon/
  │   └── getMastodonStatus.ts (UPDATE - vote context)
  ├── components/posts/
  │   ├── poll.tsx (UPDATE - interactive UI)
  │   └── __tests__/
  │       └── poll.test.tsx (NEW)
  ├── client.ts (UPDATE - add votePoll method)
  └── __tests__/
      └── poll-voting.test.ts (NEW - integration tests)

/app/api/v1/polls/
  └── [id]/
      └── votes/
          ├── route.ts (NEW)
          └── __tests__/
              └── route.test.ts (NEW)
```

**New Files:** 8
**Updated Files:** 4
**Test Files:** 5

---

## Appendix B: Database Schema Changes

**No schema changes required!** The `poll_answers` table already exists with the correct structure:

```sql
CREATE TABLE poll_answers (
  answerId TEXT PRIMARY KEY,
  choice TEXT NOT NULL,
  actorId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (choice) REFERENCES poll_choices(choiceId),
  FOREIGN KEY (actorId) REFERENCES actors(id),
  UNIQUE(actorId, choice)
);

CREATE INDEX idx_poll_answers_actor ON poll_answers(actorId);
CREATE INDEX idx_poll_answers_choice ON poll_answers(choice);
```

**Note:** May need to add the UNIQUE constraint and indexes if not present.

---

## Appendix C: API Specification

### POST /api/v1/polls/:id/votes

**Request:**
```http
POST /api/v1/polls/01234567-89ab-cdef-0123-456789abcdef/votes HTTP/1.1
Content-Type: application/json
Authorization: Bearer <session-token>

{
  "choices": [0]
}
```

**Success Response (201):**
```json
{
  "id": "01234567-89ab-cdef-0123-456789abcdef",
  "expires_at": "2024-01-15T18:30:00.000Z",
  "expired": false,
  "multiple": false,
  "votes_count": 42,
  "voters_count": 42,
  "voted": true,
  "own_votes": [0],
  "options": [
    { "title": "Option 1", "votes_count": 25 },
    { "title": "Option 2", "votes_count": 17 }
  ],
  "emojis": []
}
```

**Error Responses:**
```json
// 404 Not Found
{ "error": "Poll not found" }

// 422 Unprocessable Entity
{ "error": "Poll has ended" }
{ "error": "Invalid choice" }
{ "error": "You have already voted on this poll" }

// 401 Unauthorized
{ "error": "Authentication required" }
```

---

*Document Version: 1.0*
*Last Updated: 2024-01-10*
*Author: Claude Code Agent*

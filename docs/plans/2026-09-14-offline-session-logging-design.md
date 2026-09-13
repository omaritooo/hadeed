# Offline session logging — design

## Goal

A workout started with signal can be logged to the end without it. Basement gyms and
steel-framed buildings are where Hadeed is used most, and today a set logged there fails
with "Couldn't log that set."

## Scope

**In:** for a session already started online, log / edit / delete sets, add an exercise,
and finish — all offline, synced later.

**Out:** starting a session offline, and offline meals, hydration or body metrics. Those
tables use `INTEGER AUTOINCREMENT` ids and would each need a UUID migration first.

## Problems

The groundwork (client UUID primary keys, `version` columns, `409` responses, the
`sync_conflicts` table) exists, but nothing on the client uses it:

- **No queue.** Mutations call `$fetch` directly; offline, they just throw.
- **Non-idempotent retries.** `useLogSet` and `useStartSession` call `crypto.randomUUID()`
  *inside* the mutation function, so a retry is a new id and a duplicate row.
- **Offline looks logged out.** `app/middleware/auth.global.ts` maps any failure of
  `/api/auth/me` to `userId: null`, so the first navigation after the 30s cache expires
  redirects to `/login`.
- **No runtime caching.** `app/sw.ts` precaches build assets only; the session page's
  HTML and API reads aren't cached.
- **Server-side timestamps.** `set_logs.logged_at` and `workout_sessions.completed_at` are
  `datetime('now')` on the server, so a session finished offline and synced 40 minutes
  later records a 40-minute-too-long duration.

## Approach

An IndexedDB outbox with an optimistic overlay on the session query, ordered replay, and
service-worker runtime caching for reads.

Two alternatives were considered and rejected:

- **Workbox Background Sync.** The SW replays failed POSTs, but the page doesn't know about
  them, so a set logged offline vanishes from the list until it syncs. iOS Safari doesn't
  support the Background Sync API either.
- **Full local-first.** IndexedDB as source of truth with a sync engine. Robust, but
  rewrites the session data layer for a scope that doesn't need it.

---

## Client outbox

### Ops

```ts
type OutboxOp =
  | { kind: 'log_set', payload: LogSetPayload & { id: string, loggedAt: string } }
  | { kind: 'edit_set', payload: { setLogId: string, expectedVersion: number, corrections: EditSetLogInput } }
  | { kind: 'delete_set', payload: { setLogId: string } }
  | { kind: 'add_exercise', payload: AddFreeformExerciseInput }
  | { kind: 'complete_session', payload: { expectedVersion: number, completedAt: string } }
// every op also carries: opId, sessionId, createdAt, attempts, status ('pending' | 'failed'), lastError
```

Entity ids are generated **before** enqueueing, so replaying an op is idempotent.

### Storage

`idb-keyval` (new dependency, ~600B): the op list, plus `session:{id}` holding the last
successful server response for that session.

### Pure logic — `app/lib/outbox.ts`

- **`compact(ops)`**: an `edit_set` targeting a still-pending `log_set` folds into it; a
  `delete_set` targeting a pending `log_set` removes it and its edits; consecutive
  `edit_set`s on the same synced set collapse.
- **`applyPending(session, ops)`**: overlays pending ops onto a server session.
  `useSession` returns `applyPending(queryData ?? idbSnapshot, pendingOps)`, so a refetch
  can never hide unsynced sets, and a failed fetch falls back to the snapshot.
- **`classify(outcome)`**:

  | Outcome | Action |
  | --- | --- |
  | 2xx | Remove op |
  | Network error, 5xx | Retry with backoff 1s → 2s → 4s … capped at 60s |
  | 401 | Pause queue, keep ops, prompt login |
  | 409 | Conflict handling (below) |
  | Other 4xx | Move to failed |

### Flushing

Triggered on enqueue, the `online` event, `visibilitychange` to visible, and a 30s
interval while anything is pending. Ops flush **serially, in order, per session**, so a
set is always logged before the session completes. `navigator.locks.request('hadeed-outbox')`
keeps one tab flushing at a time. When a session's queue empties, its query is
invalidated.

### Mutations

`useLogSet`, `useEditSetLog`, `useDeleteSetLog`, the add-exercise mutation and
`useCompleteSession` enqueue and resolve immediately. Online writes go through the queue
too, so there is one code path. The session page's call sites barely change.

---

## Server changes

- **Client timestamps.** `POST /api/sessions/:id/sets` accepts `loggedAt`;
  `POST /api/sessions/:id/complete` accepts `completedAt`. Both are clamped to
  `[session.started_at, now]` and default to `datetime('now')` when absent.
- **No false conflict on replayed edits.** If an edit applied but its response was lost,
  the retry sees a bumped version. In `SessionRepository.editSetLog`'s conflict branch, if
  the current row already equals the proposed corrections, return success and write no
  `sync_conflicts` row.
- **Idempotent complete.** When the session is already `completed`,
  `SessionService.completeSession` returns the existing session and summary rather than
  `409`, without re-running gamification (XP awards are already unique-keyed).

## Conflicts

- **Set edited on another device (`409`)**: server wins. The conflict is already recorded
  in `sync_conflicts`. The page shows "Set 3 was changed on another device — your offline
  edit wasn't applied."
- **Session no longer in progress** (e.g. abandoned by the 12h expiry): the op moves to
  failed, with Retry / Discard.

## Service worker

Added to `app/sw.ts` with `workbox-routing` / `workbox-strategies`:

- **Navigations**: `NetworkFirst`, 3s timeout, so visited pages load offline.
- **`GET /api/sessions/:id`, `/api/exercises/**`, `/api/profile`**: `NetworkFirst`.
- **Writes** are never routed through the SW; the outbox owns them.

## Auth middleware

A `FetchError` without a response (offline) no longer means "logged out". The middleware
lets the navigation through if a `hadeed:last-user` localStorage marker exists. The marker
is set on a successful `/api/auth/me` and cleared by `useLogout`. A real `401` still
redirects to `/login`.

## UI

- **`SessionSyncStatus`** pill in the session header: hidden when synced; otherwise
  "Offline · 3 pending", "Syncing…", or "2 changes couldn't sync", which opens a drawer
  listing failed ops with Retry / Discard.
- **Finishing offline** shows a locally computed summary (volume, duration from client
  timestamps, set count). PRs and streak read "Available once synced". If the page is
  still open when the complete op syncs, the server summary replaces it.

## Testing

- `tests/app/lib/outbox.test.ts`: each `compact` rule, `applyPending` for every op kind
  (including an edit or delete of a pending set), and every `classify` row.
- Repository/service tests: client timestamp clamping, a replayed edit matching current
  values returns success with no conflict row, and completing an already-completed
  session returns its summary without awarding XP again.

## Out of scope

- Starting sessions offline.
- Offline meals, hydration and body metrics.
- User-chosen conflict resolution ("Keep mine").

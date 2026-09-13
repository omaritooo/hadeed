# Joint limitations — design

## Goal

Let a lifter say "my shoulder is cranky" and have Hadeed flag the exercises that commonly
load it, with a one-tap swap to one that doesn't. Domain review §18: "This does not need
to become a medical diagnosis system. It simply needs a basic exercise
exclusion/substitution mechanism."

## Approach

**Flag and suggest; never hide.** A limitation marks exercises with a warning badge and
ranks non-flagged alternatives first. The lifter decides. A shoulder that hates barbell
overhead pressing may be fine with a landmine press, and a hard exclusion would override
that knowledge.

Rejected:

- **Hard exclusion** (remove flagged exercises from search, swaps and presets). Overrides
  the lifter's own tolerance.
- **Per-exercise blocklist.** Precise, but the user has to find every problem lift
  themselves.

**Tags are stored, not derived.** `npm run db:classify-exercises` already writes
`movement_pattern` and `tier`. It also writes stressor tags, with a manual overrides file.

Rejected:

- **Derive at read time.** SQL couldn't rank swaps by them, and there is nowhere to keep
  corrections.
- **Hand-curate all 973.** Unrealistic, and new exercises would arrive untagged.

## Data

```sql
CREATE TABLE IF NOT EXISTS exercise_stressors (
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  area        TEXT NOT NULL CHECK (area IN ('knee','shoulder','lower_back','wrist','elbow','ankle')),
  source      TEXT NOT NULL CHECK (source IN ('rule','manual')),
  PRIMARY KEY (exercise_id, area)
);
CREATE INDEX IF NOT EXISTS idx_exercise_stressors_area ON exercise_stressors(area);

CREATE TABLE IF NOT EXISTS user_limitations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area    TEXT NOT NULL CHECK (area IN ('knee','shoulder','lower_back','wrist','elbow','ankle')),
  PRIMARY KEY (user_id, area)
);
```

## Tagging rules

`classifyStressors(exercise)` in `server/utils/exercise-classification.ts`, using the
existing word-boundary `nameHas`:

| Area | Rules |
| --- | --- |
| `shoulder` | `vertical_push`; dip, upright row, behind the neck, snatch, jerk, kipping |
| `lower_back` | tier-1 `hip_dominant`; barbell `knee_dominant`; barbell `horizontal_pull`; hyperextension, clean, snatch |
| `knee` | tier 1–2 `knee_dominant`; `plyometrics` category; jump, pistol |
| `wrist` | push-up, front squat, clean, handstand, wrist curl, barbell curl |
| `elbow` | `elbow_extension`; dip, close-grip |
| `ankle` | `plyometrics` category; jump, calf raise, lunge, sprint, skipping |

- The classify script deletes and rewrites `source = 'rule'` rows; `manual` rows are never
  touched.
- `exercise_stressor_overrides.json` (`{ "<exerciseId>": { "add": [...], "remove": [...] } }`)
  is applied after the rules: `add` writes `manual` rows, `remove` deletes rule rows.
- The script prints per-area counts so over-tagging is visible before shipping.

## API

- `Exercise` gains `stressors: JointArea[]`, loaded in `ExerciseRepository.attachDetails`
  alongside muscles and images.
- The profile gains `limitations: JointArea[]`; `POST /api/profile/limitations` replaces
  the set.
- `GET /api/exercises/:id/alternatives` and `/fallbacks` accept `avoid=shoulder,knee`;
  results order non-flagged first, then by the existing tier distance.
- `PresetSplitService.scorePreset` subtracts 1 per tier-1 exercise that conflicts with a
  limitation, adding a reason ("3 exercises load your shoulder"). A soft signal, not a
  filter.

Flagging in the UI is the client-side intersection of `exercise.stressors` and
`profile.limitations`.

## UI

- **Onboarding step 5**: optional chips, "Anything to work around?", skippable.
- **Profile**: an editable limitations section.
- **Warning badge** ("⚠ Shoulder") on conflicting exercises in builder search
  (`DayExercisePicker`), `ExerciseSwapSheet`, the preset review step, and session exercise
  cards.
- **Preset review step**: "Swap 3 flagged exercises" replaces each with its top
  non-flagged fallback; any with no clean fallback stay and are listed.
- **Session page**: badge only. Mid-session swapping doesn't exist.
- **Disclaimer** under the chips: "Hadeed flags exercises that commonly load these areas.
  It isn't medical advice."

## Testing

- Classification tests per area, including false-positive guards ("throw" is not "row",
  "Jerk Dip Squat" is knee-dominant not a dip).
- Repository tests: overrides applied, `manual` rows surviving a reclassify, `avoid`
  ordering in `findFallbacks`.
- Service test for the preset scoring penalty and reason.

## Out of scope

- Severity levels, or limitations that expire.
- Pain logging per set.
- Mid-session exercise swapping.

# Hadeed Training Domain — Senior Gym Trainer Review & Recommended Training Templates

## Part 1 — What is wrong with the current training system?

This review evaluates the current training domain from the perspective of a senior strength & conditioning coach, rather than as a software engineer.

The biggest issue is that the system is currently much better at describing **software rules** than describing a sound, adaptable training methodology.

---

# 1. The programs are too generic

The current catalog is essentially:

- Full Body
- Upper / Lower
- Push Pull Legs

That is a reasonable starting catalog, but individualization is currently limited to:

- training frequency
- experience
- goal
- equipment

A real recommendation system should eventually consider:

- training history
- injury limitations
- exercise preferences
- available session duration
- recovery capacity
- current strength level
- bodyweight
- whether the user is returning after a layoff
- current training volume
- proximity to failure

Age does not necessarily need to dictate training frequency, but it can still influence exercise selection, recovery considerations, progression, and volume tolerance.

---

# 2. The beginner program is not necessarily beginner-friendly

### Full Body A

| Exercise | Sets | Reps | RPE |
|---|---:|---:|---:|
| Barbell Squat | 4 | 8 | 7 |
| Barbell Bench Press | 4 | 8 | 7 |
| Bent Over Barbell Row | 3 | 10 | 7 |
| Dumbbell Shoulder Press | 3 | 10 | 7 |
| Plank | 3 | Time | — |

This is 14 working sets containing several technically demanding barbell movements.

For a genuine beginner, this can be unnecessarily demanding.

### Full Body B

| Exercise | Sets | Reps | RPE |
|---|---:|---:|---:|
| Barbell Deadlift | 3 | 6 | 7 |
| Pull-ups | 3 | 8 | 7 |
| Dumbbell Lunges | 3 | 10 | 7 |
| Incline Dumbbell Press | 3 | 10 | 7 |
| Standing Calf Raise | 3 | 15 | 7 |

The biggest issue is prescribing 3×8 pull-ups to every beginner. Many beginners cannot perform a single strict pull-up.

A better system needs exercise scaling:

> Pull-up → Assisted Pull-up → Band Pull-up → Eccentric Pull-up → Lat Pulldown

The system should understand movement patterns rather than only exercise names.

---

# 3. RPE is being used too rigidly

The current rule is essentially:

- accessories/isolation = RPE 7
- heavy compounds = RPE 8 for intermediate programs

RPE should represent effort, not simply exercise category.

A more useful general framework is:

- Heavy compounds: approximately RPE 6–9 depending on phase
- Accessories: approximately RPE 7–10
- Beginners: generally leave more reps in reserve while learning technique
- Later sets may be adjusted based on actual performance

RPE should also influence what happens in the next workout.

---

# 4. There is no progression model

This is one of the largest gaps.

The program says:

> Bench Press — 4×8 @ RPE 7

But what happens next week?

Possible progression models include:

### Double progression

3×8–10 @ RPE 7–8

If the user reaches:

> 10 / 10 / 10 while staying within the target RPE

increase the load.

Otherwise maintain the load and try to improve reps.

### RPE-based progression

If the user completes the prescribed work significantly below target RPE, increase the load.

If they significantly exceed the target RPE, reduce or maintain the load.

Without a progression system, the app is closer to a workout generator than a true training program.

---

# 5. There is no deload strategy

The Block model provides a natural place for training phases, but there is currently no fatigue-management strategy.

A possible structure:

- Weeks 1–4: accumulation/progression
- Week 5: optional deload based on performance/fatigue
- Weeks 6–9: progression

A deload does not have to happen on a fixed schedule. The system can eventually use performance and subjective fatigue to determine when one is appropriate.

---

# 6. There is no volume management

The programs prescribe sets, but the system does not appear to reason about weekly muscle volume.

For example, PPL can produce very different workloads depending on whether the user trains:

- 5 days
- 6 days
- 3 days
- a rolling PPL schedule

The system needs to calculate at least:

- direct sets per muscle
- indirect sets
- weekly frequency
- hard sets
- total volume
- approximate fatigue cost

---

# 7. PPL needs a real 5-day vs 6-day strategy

Saying:

> PPL — 5–6 days/week

is ambiguous.

A six-day rotation can be:

> Push / Pull / Legs / Push / Pull / Legs

A five-day program needs a defined rotation.

A rolling PPL is preferable:

> Push / Pull / Legs / Rest / Push / Pull / Legs / Rest ...

This prevents the same body part from permanently receiving less frequency simply because a week contains five training days.

The application should explicitly model the rotation rather than treating 5–6 days as a vague range.

---

# 8. There is no recovery logic

Available training days are not the same as recommended training days.

A user saying:

> "I can train 6 days"

does not automatically mean:

> "You should train 6 days."

The recommendation engine should consider:

- training age
- current volume
- recovery
- sleep
- stress
- previous adherence
- goal
- session duration

---

# 9. Goal categories are too shallow

Current goals include:

- general fitness
- muscle gain

A stronger system should eventually support:

- hypertrophy
- strength
- fat loss
- recomposition
- general fitness
- muscular endurance
- athletic performance

Importantly, fat loss does not require a special "fat loss workout." Resistance training remains useful; the primary driver of fat loss is the energy balance.

---

# 10. TDEE is an estimate, not an exact measurement

The Mifflin-St Jeor implementation is mathematically appropriate, but:

> TDEE = BMR × activity multiplier

is an estimate.

The UI should communicate:

> Estimated maintenance: ~2,550 kcal/day

rather than presenting the value as exact.

The better long-term approach is to calibrate estimated TDEE using actual weight trends.

Example:

1. Estimate maintenance.
2. Track average calorie intake.
3. Track rolling bodyweight average.
4. Observe weight change over 2–4 weeks.
5. Adjust the estimated maintenance accordingly.

---

# 11. BMI should not drive training recommendations

BMI is fine as an informational metric.

However, it should not become a meaningful training-programming variable.

A muscular individual can have a high BMI while having low body fat.

Treat BMI as:

> informational health metric

rather than:

> programming input.

---

# 12. There is no body-composition logic

For a nutrition-oriented system, weight alone eventually becomes insufficient.

Useful future measurements include:

- waist circumference
- body-fat estimate
- weight trend
- lean mass
- progress photos

This is not required for V1, but it becomes useful later.

---

# 13. The macro system is incomplete

The intended system is:

> TDEE + weight goal → macro targets

but this is not implemented.

A proper implementation should consider:

1. Goal
2. Desired rate of weight change
3. Calorie target
4. Protein target
5. Minimum fat target
6. Remaining calories assigned to carbohydrates

The target should then be adjusted based on actual weight trends.

---

# 14. Protein should not be a single fixed number

Protein should generally be calculated relative to the user's bodyweight and goal rather than assigning everyone the same value.

The Block's `proteinG` field is appropriate as a stored result, but the application needs a clear methodology for calculating it.

---

# 15. Exercise selection needs movement-pattern metadata

Exercises should eventually have structured metadata such as:

```text
movementPattern
primaryMuscles
secondaryMuscles
equipment
difficulty
stabilityDemand
fatigueCost
skillRequirement
```

For example:

### Barbell Squat

- squat
- quadriceps
- glutes
- high fatigue
- high skill requirement

### Leg Extension

- knee extension
- quadriceps
- low systemic fatigue
- low skill requirement

This allows the recommendation engine to make intelligent substitutions and volume decisions.

---

# 16. There is no warm-up system

The app prescribes working sets but does not address warm-ups.

You do not necessarily need to prescribe exact warm-up sets in V1, but the application should at least provide guidance for major compound movements.

---

# 17. There is no exercise substitution system

Users should be able to say:

> "I don't want to do barbell squats."

The system should substitute based on movement pattern and requirements rather than randomly choosing another leg exercise.

Example:

> Barbell Squat → Hack Squat → Leg Press → Goblet Squat

The actual choice should depend on:

- equipment
- experience
- goal
- preference
- limitations

---

# 18. There is no injury/limitation handling

This is an important safety and personalization gap.

The system should eventually support basic exercise exclusions or limitations around areas such as:

- knee
- shoulder
- lower back
- wrist
- elbow
- ankle

Exercises can then be tagged with relevant stressors or contraindication flags.

This does not need to become a medical diagnosis system. It simply needs a basic exercise exclusion/substitution mechanism.

---

# 19. Recommendation scoring is too naive

The current 9-point model is clean:

- Frequency: 3
- Experience: 2
- Goal: 2
- Equipment: 2

But not all factors should necessarily be soft preferences.

For example, equipment can be a hard constraint.

If someone has only dumbbells and a program requires a barbell rack, simply awarding zero equipment points is not enough.

The system should distinguish:

### Hard constraints

> Cannot perform this program without required equipment.

### Soft preferences

> This program is slightly less ideal because the frequency does not perfectly match.

---

# 20. Equipment matching is too simplistic

Current categories:

- gym
- home
- both

are insufficient.

"Home equipment" could mean:

- yoga mat only
- dumbbells
- adjustable dumbbells
- resistance bands
- barbell and rack
- cable machine
- full home gym

The better approach is an equipment inventory:

```text
dumbbells
barbell
rack
bench
cables
pullup_bar
resistance_bands
machines
```

Exercises then declare their requirements.

---

# 21. Experience should not only be a global label

Someone can be "intermediate" overall but still be a beginner at a particular movement.

For example:

- intermediate lifter
- beginner at barbell squatting
- beginner at deadlifting
- advanced at machine work

Exercise-level difficulty is therefore useful.

---

# 22. The streak system may be too punishing

The weekly streak concept is better than a simplistic daily streak, but:

> miss one scheduled day → streak resets to 0

can be unnecessarily harsh.

A user who completes 20 consecutive weeks and then misses one session due to illness immediately losing everything can be demotivating.

Potential alternatives:

- streak freeze
- recovery week
- minimum adherence threshold
- rolling compliance

For example:

> 90% weekly adherence preserves the streak.

---

# 23. "7-Day Streak" is misleading

The current achievement says:

> 7-Day Streak

but actually means:

> one completely completed training week.

Those are not necessarily the same thing.

Better names:

> First Week Complete

or:

> 7-Day Training Streak

if the system truly means seven consecutive days.

---

# 24. XP rewards logging rather than training quality

The current:

> Logging one set = +10 XP

can create the wrong incentive.

Someone could gain significant XP primarily by logging data.

XP should prioritize:

- completing planned work
- completing sessions
- consistent adherence
- progression
- PRs

rather than the act of entering information.

---

# 25. XP can potentially be gamed

If users can manually create completed sets, XP can potentially be fabricated.

The system should distinguish:

```text
planned set
completed set
manually logged set
verified/scheduled set
```

XP should ideally be awarded based on legitimate completed training rather than arbitrary data entry.

---

# 26. PR detection needs more nuance

Epley's formula is:

> estimated 1RM = weight × (1 + reps / 30)

This is useful but an estimated 1RM PR is not necessarily the same thing as a traditional PR.

Consider separating:

- weight PR
- rep PR
- estimated 1RM PR

This produces much better progress reporting.

---

# 27. There is no fatigue/performance tracking

A useful training app should eventually be able to recognize:

> "Your squat performance has declined for three consecutive sessions."

Track:

- load
- reps
- RPE
- estimated 1RM
- volume
- adherence
- performance trend

This is much more valuable than simply awarding XP.

---

# 28. RPE does not currently drive autoregulation

The RPE field creates the foundation for autoregulation, but the system does not appear to use it.

Example:

Prescribed:

> Bench 4×8 @7

User reports:

> 8 @9  
> 7 @9  
> 6 @10

The system should recognize that the load may be too heavy or recovery may be poor.

Conversely:

> 8 @6  
> 8 @6  
> 8 @6  
> 8 @6

may indicate the user can increase load.

This is where the RPE data becomes genuinely valuable.

---

# 29. Program/template/user-plan concepts should be separated

Conceptually, these are different entities:

### Program Template

> Upper / Lower

### User Program

> Omar's Upper / Lower

### Training Block

> Hypertrophy Block — August 2026

### Sessions

> Actual workouts performed

### Set Logs

> What actually happened

This separation becomes increasingly important as users modify and progress programs.

---

# 30. The biggest missing piece: actual sessions

The current system mostly describes what someone intends to do.

It does not yet describe what actually happened.

A future model should look roughly like:

```text
WorkoutSession
    ↓
ExerciseLog
    ↓
SetLog
```

with fields such as:

```text
actualWeight
actualReps
actualRpe
duration
completed
timestamp
```

Once this exists, the system can support:

> Plan → Perform → Measure → Adapt

That is the real foundation of a good training app.

---

# Recommended priority order

## Critical

1. Add progression logic.
2. Add actual workout/session logging.
3. Add exercise substitution.
4. Add basic injury/limitation exclusions.
5. Improve beginner exercise prescriptions.
6. Define the 5-day and 6-day PPL strategies.
7. Add volume/frequency analysis.
8. Make equipment more granular.
9. Make RPE influence progression.
10. Fix misleading streak terminology.

## Important

11. Add deload/block progression.
12. Add movement-pattern metadata.
13. Add exercise difficulty.
14. Improve recommendation scoring.
15. Add weight-trend-based TDEE adjustment.
16. Implement proper macro targets.
17. Improve PR detection.
18. Add adherence/performance analytics.
19. Make XP harder to exploit.
20. Add recovery considerations.

## Later

21. Body-composition tracking.
22. Advanced autoregulation.
23. Fatigue modeling.
24. Personalized program generation.
25. AI coaching.

---

# Fundamental training architecture

The current mental model is:

> "Here's a workout plan for you."

The better model is:

> "Here's an initial plan based on your profile. We observe how you perform it, then progressively adapt the plan based on your performance and recovery."

The full training loop should become:

**Assessment → Prescription → Execution → Tracking → Progression → Adaptation**

The current system has a good foundation for assessment and prescription. The execution, tracking, and adaptation layers are where the product can become genuinely useful.

---

# Part 2 — Recommended Training Split Templates

The following templates are intended as **starting templates**, not rigid prescriptions. Exact volume, exercise selection, intensity, and progression should be adjusted for the trainee's experience, recovery, equipment, and goals.

---

# 1. PPL — Push / Pull / Legs

## Best for

- Intermediate lifters
- 5–6 training days
- Hypertrophy
- People who enjoy higher training frequency

## 6-Day Version

### Day 1 — Push

| Exercise | Sets | Reps | Target |
|---|---:|---:|---:|
| Barbell Bench Press | 3 | 5–8 | RPE 7–8 |
| Incline Dumbbell Press | 3 | 8–12 | RPE 8 |
| Dumbbell Shoulder Press | 3 | 8–12 | RPE 8 |
| Cable/Lateral Raise | 3 | 12–20 | RPE 8–9 |
| Triceps Pushdown | 3 | 10–15 | RPE 8–9 |

### Day 2 — Pull

| Exercise | Sets | Reps | Target |
|---|---:|---:|---:|
| Barbell Row | 3 | 6–10 | RPE 7–8 |
| Lat Pulldown / Pull-up | 3 | 8–12 | RPE 8 |
| Chest-Supported Row | 3 | 8–12 | RPE 8 |
| Face Pull / Reverse Fly | 3 | 12–20 | RPE 8–9 |
| Hammer Curl | 3 | 10–15 | RPE 8–9 |

### Day 3 — Legs

| Exercise | Sets | Reps | Target |
|---|---:|---:|---:|
| Squat | 3 | 5–8 | RPE 7–8 |
| Romanian Deadlift | 3 | 6–10 | RPE 7–8 |
| Leg Press | 3 | 8–15 | RPE 8 |
| Leg Curl | 3 | 10–15 | RPE 8–9 |
| Calf Raise | 4 | 10–20 | RPE 8–9 |

### Days 4–6

Repeat:

> Push → Pull → Legs

### Day 7

Rest.

---

# 2. ULUL — Upper / Lower / Upper / Lower

## Best for

- Intermediate lifters
- 4 training days
- Hypertrophy + strength
- People who want good recovery

### Day 1 — Upper A

| Exercise | Sets | Reps |
|---|---:|---:|
| Bench Press | 3 | 5–8 |
| Barbell/Chest-Supported Row | 3 | 6–10 |
| Incline DB Press | 3 | 8–12 |
| Lat Pulldown | 3 | 8–12 |
| Lateral Raise | 3 | 12–20 |
| Triceps | 2 | 10–15 |
| Biceps | 2 | 10–15 |

### Day 2 — Lower A

| Exercise | Sets | Reps |
|---|---:|---:|
| Squat | 3 | 5–8 |
| Romanian Deadlift | 3 | 6–10 |
| Leg Press | 3 | 8–12 |
| Leg Curl | 3 | 10–15 |
| Calf Raise | 4 | 10–20 |

### Day 3

Rest.

### Day 4 — Upper B

| Exercise | Sets | Reps |
|---|---:|---:|
| Incline Bench | 3 | 6–10 |
| Pull-up / Lat Pulldown | 3 | 6–10 |
| DB Shoulder Press | 3 | 8–12 |
| Cable Row | 3 | 8–12 |
| Lateral Raise | 3 | 12–20 |
| Biceps | 2–3 | 10–15 |
| Triceps | 2–3 | 10–15 |

### Day 5 — Lower B

| Exercise | Sets | Reps |
|---|---:|---:|
| Deadlift / Trap Bar Deadlift | 2–3 | 4–6 |
| Hack Squat / Front Squat | 3 | 6–10 |
| Hip Thrust | 3 | 8–12 |
| Leg Extension | 3 | 10–15 |
| Leg Curl | 3 | 10–15 |
| Calf Raise | 4 | 10–20 |

---

# 3. FBEOD — Full Body Every Other Day

## Best for

- Beginners
- Early intermediates
- 3–4 training sessions per week
- People who prefer flexible schedules
- People who cannot commit to fixed weekdays

Example rotation:

> Train → Rest → Train → Rest → Train → Rest...

The program should rotate A/B rather than forcing the same workout every session.

## Workout A

| Exercise | Sets | Reps |
|---|---:|---:|
| Squat | 3 | 6–10 |
| Bench Press | 3 | 6–10 |
| Row | 3 | 8–12 |
| Leg Curl | 2 | 10–15 |
| Lateral Raise | 2 | 12–20 |
| Plank | 3 | 30–60 sec |

## Workout B

| Exercise | Sets | Reps |
|---|---:|---:|
| Romanian Deadlift | 3 | 6–10 |
| Incline DB Press | 3 | 8–12 |
| Lat Pulldown | 3 | 8–12 |
| Leg Press / Split Squat | 3 | 8–12 |
| Curl | 2 | 10–15 |
| Triceps | 2 | 10–15 |

Rotation:

> A → Rest → B → Rest → A → Rest → B...

---

# 4. Bro Split

## Best for

- Advanced/intermediate hypertrophy trainees
- People who enjoy body-part-focused training
- 5 training days
- Higher per-session muscle volume

Classic version:

> Chest → Back → Shoulders → Legs → Arms → Rest → Rest

## Day 1 — Chest

| Exercise | Sets | Reps |
|---|---:|---:|
| Bench Press | 3 | 5–8 |
| Incline DB Press | 3 | 8–12 |
| Machine Chest Press | 3 | 8–12 |
| Cable Fly | 3 | 12–20 |

## Day 2 — Back

| Exercise | Sets | Reps |
|---|---:|---:|
| Pull-up / Pulldown | 3 | 6–10 |
| Barbell Row | 3 | 6–10 |
| Chest-Supported Row | 3 | 8–12 |
| Single-Arm Pulldown | 3 | 10–15 |
| Rear Delt Fly | 3 | 12–20 |

## Day 3 — Shoulders

| Exercise | Sets | Reps |
|---|---:|---:|
| Overhead Press | 3 | 6–10 |
| Lateral Raise | 4 | 12–20 |
| Machine Shoulder Press | 3 | 8–12 |
| Cable Lateral Raise | 3 | 12–20 |
| Rear Delt Fly | 3 | 12–20 |

## Day 4 — Legs

| Exercise | Sets | Reps |
|---|---:|---:|
| Squat | 3 | 5–8 |
| Romanian Deadlift | 3 | 6–10 |
| Leg Press | 3 | 8–15 |
| Leg Curl | 3 | 10–15 |
| Leg Extension | 3 | 10–15 |
| Calf Raise | 4 | 10–20 |

## Day 5 — Arms

| Exercise | Sets | Reps |
|---|---:|---:|
| EZ Curl | 3 | 8–12 |
| Skullcrusher | 3 | 8–12 |
| Hammer Curl | 3 | 10–15 |
| Triceps Pushdown | 3 | 10–15 |
| Preacher Curl | 3 | 10–15 |
| Overhead Triceps Extension | 3 | 10–15 |

### Important note

The Bro Split is not inherently bad, but once-per-week muscle frequency is not automatically superior for hypertrophy. It works well when the trainee prefers it and can produce enough high-quality weekly work.

---

# 5. Arnold Split

Classic structure:

> Chest + Back  
> Shoulders + Arms  
> Legs  
> Repeat

Usually six training days.

## Day 1 — Chest + Back

| Exercise | Sets | Reps |
|---|---:|---:|
| Bench Press | 3 | 6–8 |
| Pull-up / Pulldown | 3 | 6–10 |
| Incline DB Press | 3 | 8–12 |
| Barbell/Chest-Supported Row | 3 | 8–12 |
| Cable Fly | 2 | 12–20 |
| Straight-Arm Pulldown | 2 | 12–15 |

## Day 2 — Shoulders + Arms

| Exercise | Sets | Reps |
|---|---:|---:|
| Overhead Press | 3 | 6–10 |
| Lateral Raise | 3 | 12–20 |
| Rear Delt Fly | 3 | 12–20 |
| EZ Curl | 3 | 8–12 |
| Triceps Extension | 3 | 8–12 |
| Hammer Curl | 2 | 10–15 |
| Triceps Pushdown | 2 | 10–15 |

## Day 3 — Legs

| Exercise | Sets | Reps |
|---|---:|---:|
| Squat | 3 | 5–8 |
| Romanian Deadlift | 3 | 6–10 |
| Leg Press | 3 | 8–12 |
| Leg Curl | 3 | 10–15 |
| Leg Extension | 3 | 10–15 |
| Calf Raise | 4 | 10–20 |

Days 4–6 repeat.

Day 7 rest.

---

# 6. Full Body 3×/Week

## Best for

- Beginners
- People with limited time
- General fitness
- Muscle gain for newer trainees

Schedule:

> Monday — A  
> Wednesday — B  
> Friday — A

Next week:

> Monday — B  
> Wednesday — A  
> Friday — B

## Workout A

| Exercise | Sets | Reps |
|---|---:|---:|
| Squat | 3 | 6–10 |
| Bench Press | 3 | 6–10 |
| Lat Pulldown | 3 | 8–12 |
| Romanian Deadlift | 2 | 8–12 |
| Lateral Raise | 2 | 12–20 |
| Curl | 2 | 10–15 |

## Workout B

| Exercise | Sets | Reps |
|---|---:|---:|
| Leg Press | 3 | 8–12 |
| Incline DB Press | 3 | 8–12 |
| Row | 3 | 8–12 |
| Leg Curl | 3 | 10–15 |
| Shoulder Press | 2 | 8–12 |
| Triceps | 2 | 10–15 |

---

# 7. Upper / Lower 3×/Week

Useful when a person wants more frequency than traditional ULUL but cannot train four days every week.

Use a rolling rotation:

> Upper → Lower → Upper → Lower → ...

Example:

### Upper

- Bench Press — 3×6–10
- Row — 3×6–10
- Incline DB Press — 3×8–12
- Lat Pulldown — 3×8–12
- Lateral Raise — 3×12–20
- Arms — 2×10–15 each

### Lower

- Squat — 3×6–10
- Romanian Deadlift — 3×6–10
- Leg Press — 3×8–12
- Leg Curl — 3×10–15
- Calf Raise — 4×10–20

The rotation should continue regardless of calendar week.

---

# 8. PHUL — Power / Hypertrophy Upper Lower

## Best for

- Intermediate lifters
- Strength + hypertrophy
- Four days per week

Schedule:

> Upper Power  
> Lower Power  
> Rest  
> Upper Hypertrophy  
> Lower Hypertrophy

### Upper Power

- Bench Press — 3–4×3–6
- Row — 3–4×4–6
- Overhead Press — 3×5–8
- Pull-up — 3×5–8
- Curl — 2–3×8–12
- Triceps — 2–3×8–12

### Lower Power

- Squat — 3–4×3–6
- Deadlift — 2–3×3–5
- Leg Press — 3×6–10
- Leg Curl — 3×8–12
- Calf Raise — 4×8–15

### Upper Hypertrophy

- Incline DB Press — 3×8–12
- Lat Pulldown — 3×8–12
- Machine Press — 3×10–15
- Cable Row — 3×10–15
- Lateral Raise — 3×12–20
- Biceps — 3×10–15
- Triceps — 3×10–15

### Lower Hypertrophy

- Hack Squat — 3×8–12
- Romanian Deadlift — 3×8–12
- Leg Press — 3×10–15
- Leg Curl — 3×10–15
- Leg Extension — 3×10–15
- Calf Raise — 4×12–20

---

# 9. PHAT — Power Hypertrophy Adaptive Template

A more advanced five-day structure:

> Day 1 — Upper Power  
> Day 2 — Lower Power  
> Day 3 — Rest  
> Day 4 — Back + Shoulders Hypertrophy  
> Day 5 — Lower Hypertrophy  
> Day 6 — Chest + Arms Hypertrophy  
> Day 7 — Rest

This is best treated as an advanced template rather than a default recommendation.

---

# Programming Rules These Templates Should Share

Regardless of the split, the application should eventually use common rules.

## Intensity

Most working sets should generally sit around:

> RPE 6–9

rather than assigning RPE 7 or 8 universally.

Beginners should generally stay further from failure while learning technique.

---

## Rep ranges

Useful broad defaults:

| Exercise type | Typical range |
|---|---:|
| Heavy compound | 4–8 |
| Moderate compound | 6–12 |
| Machine/accessory | 8–15 |
| Isolation | 10–20 |
| Calves | 10–20 |
| Abs | 8–20 or timed |

These are guidelines, not hard rules.

---

# Progression System

A strong default for the application is **double progression**.

Example:

> Bench Press — 3×8–10 @ RPE 7–8

If the user completes:

> 10 / 10 / 10 @ ≤8

increase the load next session.

If they complete:

> 10 / 9 / 8

keep the load and attempt to beat the previous performance.

If they repeatedly exceed the target RPE:

> reduce or maintain load.

---

# Volume Guidelines

For hypertrophy programming, a reasonable starting framework is:

### Beginners

Approximately:

> 6–10 hard sets per muscle/week

### Intermediate

Approximately:

> 8–16 hard sets per muscle/week

### Advanced

Potentially:

> 10–20+ sets

But these should not be treated as universal prescriptions.

The application should adjust volume based on:

- performance
- recovery
- experience
- frequency
- exercise selection
- adherence

More volume is not automatically better.

---

# The most important product principle

The app should not think:

> Split = program.

Instead:

> **Split = organizational structure.**

The actual program consists of:

**Exercise Selection + Volume + Intensity + Frequency + Progression + Recovery + Adaptation**

A PPL can be excellent or terrible depending on how those variables are programmed.

The same applies to ULUL, FBEOD, Bro Split, Arnold, PHUL, PHAT, and every other split.

The split itself is only the container.

---

# Recommended V1 Preset Catalog

If the goal is to build a useful preset library, I would start with:

| Preset | Frequency | Level | Primary Goal |
|---|---:|---|---|
| Full Body 3× | 3 | Beginner | General fitness / hypertrophy |
| Full Body EOD | 3–4 | Beginner–Intermediate | Hypertrophy |
| Upper / Lower | 4 | Beginner–Intermediate | Hypertrophy |
| Upper / Lower Strength | 4 | Intermediate | Strength |
| PPL | 5–6 | Intermediate | Hypertrophy |
| Arnold | 6 | Intermediate–Advanced | Hypertrophy |
| Bro Split | 5 | Intermediate–Advanced | Hypertrophy |
| PHUL | 4 | Intermediate | Strength + hypertrophy |

The application should not recommend every template simply because the user can technically perform it.

It should first determine:

1. What can the user realistically recover from?
2. What can they consistently adhere to?
3. What fits their available equipment?
4. What matches their experience?
5. What matches their goal?
6. What provides an appropriate amount of volume?
7. What can be progressively overloaded?

Then select the split.

---

# Final Coaching Principle

A good gym application should evolve from:

> **Preset workout generator**

into:

> **Adaptive training system**

The ideal loop is:

```text
User Assessment
      ↓
Initial Program
      ↓
Workout
      ↓
Set / Rep / RPE Logging
      ↓
Performance Analysis
      ↓
Progression Decision
      ↓
Volume / Exercise Adjustment
      ↓
Next Workout
      ↓
Repeat
```

That is the direction that will make Hadeed significantly more useful than a simple collection of workout templates.

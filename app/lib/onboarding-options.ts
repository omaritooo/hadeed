import type { Component } from "vue"
import {
  AccessibilityIcon,
  DumbbellIcon,
  FlameIcon,
  HeartIcon,
  HomeIcon,
  PersonStandingIcon,
  WeightIcon,
  WrenchIcon,
} from "@lucide/vue"
import type { Equipment } from "~~/shared/types/preset.types"
import type { ExperienceLevel, Goal } from "~~/shared/types/profile.types"

export interface OnboardingOption<T extends string> {
  value: T
  icon: Component
  title: string
  description?: string
}

// The 4 concrete equipment tiers offered anywhere a user picks their equipment --
// onboarding's FifthStep and Profile's Training Preferences section both render this
// exact list via UiOptionCardGroup. 'both' is deliberately never offered here (see
// shared/schemas/onboarding.ts's equipment enum comment) -- it's a valid Equipment
// value elsewhere (preset_splits, recommendation queries) but never a concrete
// user_profiles.equipment choice.
export const equipmentOptions: OnboardingOption<Exclude<Equipment, "both">>[] = [
  { value: "full_gym", icon: DumbbellIcon, title: "Full Gym", description: "Barbells, machines, and full equipment access" },
  { value: "home_barbell_dumbbell", icon: HomeIcon, title: "Home Gym", description: "Barbell and dumbbells at home" },
  { value: "home_dumbbell_only", icon: WeightIcon, title: "Dumbbells Only", description: "Dumbbells at home, no barbell" },
  { value: "bodyweight", icon: PersonStandingIcon, title: "Bodyweight", description: "No equipment at all" },
]

// The 5 primary-goal options, including `mobility`. Shared between onboarding's
// ThirdStep and Profile's Training Preferences section.
export const goalOptions: OnboardingOption<Goal>[] = [
  { value: "fat_loss", icon: FlameIcon, title: "Fat Loss", description: "New to exercising" },
  { value: "muscle_gain", icon: DumbbellIcon, title: "Muscle Gain", description: "Hypertrophy & Size" },
  { value: "maintenance", icon: WrenchIcon, title: "Maintenance", description: "3+ years" },
  { value: "general_fitness", icon: HeartIcon, title: "General Health", description: "3+ years" },
  { value: "mobility", icon: AccessibilityIcon, title: "Mobility", description: "Flexibility & Movement" },
]

// Shared between onboarding's SecondStep (alongside its own activity-level options,
// which aren't reused here -- Profile only exposes experience level, not activity
// level, for post-signup editing) and Profile's Training Preferences section.
export const experienceOptions: OnboardingOption<ExperienceLevel>[] = [
  { value: "beginner", icon: PersonStandingIcon, title: "Beginner", description: "New to exercising" },
  { value: "intermediate", icon: DumbbellIcon, title: "Intermediate", description: "1-3 years" },
  { value: "advanced", icon: FlameIcon, title: "Experienced", description: "3+ years" },
]

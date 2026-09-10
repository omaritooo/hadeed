import type { FetchError } from 'ofetch'
import type { Equipment } from '~~/shared/types/preset.types'
import type { ExperienceLevel, Goal, UnitSystem, UserProfile } from '~~/shared/types/profile.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export interface UpdateProfilePreferencesInput {
  equipment: Equipment
  primaryGoal: Goal
  experienceLevel: ExperienceLevel
  unitSystem: UnitSystem
}

export const useUpdateProfilePreferences = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<{ profile: UserProfile }, UpdateProfilePreferencesInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<{ profile: UserProfile }>('/api/profile/preferences', {
      method: 'POST',
      body: input,
    }),
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.profile() }),
  })
}

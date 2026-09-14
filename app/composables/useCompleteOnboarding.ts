import type { FetchError } from 'ofetch'
import type { CompleteOnboardingInput } from '~~/server/services/profile.service'
import type { UserProfile, UserTarget } from '~~/shared/types/profile.types'
import type { JointArea } from '~~/shared/lib/joint-areas'
import { useMutation, useQueryCache } from '@pinia/colada'

export type CompletedOnboardingProfile = (UserProfile & { displayName: string | null, targets: UserTarget[], limitations: JointArea[] }) | null

export const useCompleteOnboarding = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<CompletedOnboardingProfile, CompleteOnboardingInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<CompletedOnboardingProfile>('/api/profile/onboarding', {
      method: 'POST',
      body: input,
    }),
    onSuccess: () => {
      queryCache.invalidateQueries({ key: queryKeys.tdeeEstimate() }).catch(() => {})
      return queryCache.invalidateQueries({ key: queryKeys.profile() })
    },
  })
}

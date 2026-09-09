import type { FetchError } from 'ofetch'
import type { PresetExerciseOverride } from '~~/shared/types/preset.types'
import type { Block } from '~~/shared/types/split.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export interface CreateBlockFromPresetInput {
  presetSplitId: number
  name: string
  startDate: string
  endDate: string | null
  exerciseOverrides?: PresetExerciseOverride[]
}

export const useCreateBlockFromPreset = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<Block, CreateBlockFromPresetInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<Block>('/api/blocks/from-preset', {
      method: 'POST',
      body: input,
    }),
    // A new active block changes home's todaysWorkout/activeSession/weeklyProgress.
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.home() }),
  })
}

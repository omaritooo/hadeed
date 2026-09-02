import type { FetchError } from 'ofetch'
import type { CreatePresetSplitInput } from '~~/server/repositories/preset-split.repository'
import type { PresetSplit } from '~~/shared/types/preset.types'
import { useMutation, useQueryCache } from '@pinia/colada'

export const useCreatePresetSplit = () => {
  const { $api } = useNuxtApp()
  const queryCache = useQueryCache()

  return useMutation<PresetSplit, CreatePresetSplitInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<PresetSplit>('/api/preset-splits', {
      method: 'POST',
      body: input,
    }),
    // Not exact: also covers ['preset-splits', 'recommend', ...] so a new preset can appear in
    // recommendation results without a manual refetch.
    onSuccess: () => queryCache.invalidateQueries({ key: queryKeys.presetSplits() }),
  })
}

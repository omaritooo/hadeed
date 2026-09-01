import type { FetchError } from 'ofetch'
import type { CreatePresetSplitInput } from '~~/server/repositories/preset-split.repository'
import type { PresetSplit } from '~~/shared/types/preset.types'
import { useMutation } from '@pinia/colada'

export const useCreatePresetSplit = () => {
  const { $api } = useNuxtApp()

  return useMutation<PresetSplit, CreatePresetSplitInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<PresetSplit>('/api/preset-splits', {
      method: 'POST',
      body: input,
    }),
  })
}

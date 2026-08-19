import type { FetchError } from 'ofetch'
import type { Block } from '~~/shared/types/split.types'
import { useMutation } from '@pinia/colada'

export interface CreateBlockFromPresetInput {
  presetSplitId: number
  name: string
  startDate: string
  endDate: string | null
}

export function useCreateBlockFromPreset() {
  const { $api } = useNuxtApp()

  return useMutation<Block, CreateBlockFromPresetInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<Block>('/api/blocks/from-preset', {
      method: 'POST',
      body: input,
    }),
  })
}

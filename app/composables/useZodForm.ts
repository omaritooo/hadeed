import type { z } from "zod"

export function useZodForm<Schema extends z.ZodObject<z.ZodRawShape>>(
  schema: Schema,
  initialValues: z.infer<Schema>,
) {
  type Values = z.infer<Schema>
  type Key = keyof Values

  const form = reactive(structuredClone(initialValues)) as Values
  const errors = reactive(
    Object.fromEntries(Object.keys(initialValues).map(key => [key, [] as string[]])),
  ) as Record<Key, string[]>

  function validateField(field: Key) {
    const result = schema.shape[field as string].safeParse(form[field])
    errors[field] = result.success ? [] : result.error.issues.map(issue => issue.message)
  }

  function validateAll() {
    const result = schema.safeParse(form)
    const fieldErrors = result.success ? {} : result.error.flatten().fieldErrors as Record<string, string[] | undefined>

    for (const key of Object.keys(errors) as Key[]) {
      errors[key] = fieldErrors[key as string] ?? []
    }

    return result.success
  }

  function reset() {
    Object.assign(form, structuredClone(initialValues))
    for (const key of Object.keys(errors) as Key[]) errors[key] = []
  }

  return { form, errors, validateField, validateAll, reset }
}

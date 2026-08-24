<script setup lang="ts">
import { Field, FieldError, FieldLabel } from "."

defineProps<{
  label: string
  name: string
  errors?: string[]
}>()
</script>

<template>
  <Field :data-invalid="!!errors?.length">
    <FieldLabel :for="name">{{ label }}</FieldLabel>
    <slot :id="name" :aria-invalid="!!errors?.length" />
    <FieldError :errors="errors" />
  </Field>
</template>

<script setup lang="ts">
import { loginSchema } from "~~/shared/schemas/login";
import { FormField } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon, CheckIcon, LockIcon, Mail } from "@lucide/vue";

const { form, errors, touched, validateField, validateAll } = useZodForm(loginSchema, {
  email: "",
  password: "",
});

function fieldValid(field: keyof typeof form) {
  return touched[field] && errors[field].length === 0;
}

const rememberMe = ref(false);

function handleSubmit() {
  if (!validateAll()) return;
  // No auth backend yet — nothing to call.
}
</script>

<template>
  <div class="flex flex-1 flex-col">
    <div class="flex flex-1 flex-col gap-6 px-2 pt-4 pb-8">
      <div class="space-y-1 text-center">
        <h1 class="font-heading text-headline-lg-mobile text-foreground">Welcome back</h1>
        <p class="text-muted-foreground">Log in to continue your training.</p>
      </div>

      <div
        class="flex flex-col gap-5 rounded-2xl bg-card p-5 **:data-[slot=field-label]:text-xs **:data-[slot=field-label]:uppercase **:data-[slot=field-label]:tracking-wide **:data-[slot=field-label]:text-muted-foreground"
      >
        <FormField
          label="Email"
          name="email"
          :errors="errors.email"
          v-slot="{ id, ariaInvalid }"
        >
          <UiInputGroup class="h-auto gap-x-1" :valid="fieldValid('email')">
            <UiInputGroupAddon class=""> <Mail /> </UiInputGroupAddon>
            <UiInputGroupInput
              :id="id"
              class="h-full"
              v-model="form.email"
              placeholder="Enter your email"
              :aria-invalid="ariaInvalid"
              @blur="validateField('email')"
            />
            <UiInputGroupAddon v-if="fieldValid('email')" align="inline-end">
              <div class="bg-md-tertiary flex size-5 shrink-0 items-center justify-center rounded-full">
                <CheckIcon class="text-md-on-tertiary size-3" />
              </div>
            </UiInputGroupAddon>
          </UiInputGroup>
        </FormField>

        <FormField
          label="Password"
          name="password"
          :errors="errors.password"
          v-slot="{ id, ariaInvalid }"
        >
          <UiInputGroup class="h-auto gap-x-1" :valid="fieldValid('password')">
            <UiInputGroupAddon class=""> <LockIcon /> </UiInputGroupAddon>
            <UiInputGroupInput
              :id="id"
              class="h-full"
              v-model="form.password"
              type="password"
              placeholder="Enter your password"
              :aria-invalid="ariaInvalid"
              @blur="validateField('password')"
            />
            <UiInputGroupAddon v-if="fieldValid('password')" align="inline-end">
              <div class="bg-md-tertiary flex size-5 shrink-0 items-center justify-center rounded-full">
                <CheckIcon class="text-md-on-tertiary size-3" />
              </div>
            </UiInputGroupAddon>
          </UiInputGroup>
        </FormField>

        <label class="flex items-center gap-2 text-sm text-muted-foreground">
          <UiCheckbox v-model="rememberMe" />
          Remember me
        </label>
      </div>

      <Button class="w-full" size="lg" @click="handleSubmit">
        Log In
        <ArrowRightIcon class="size-4" />
      </Button>

      <p class="text-center text-sm text-muted-foreground">
        Don't have an account?
        <NuxtLink to="/onboarding" class="text-primary font-medium">Sign up</NuxtLink>
      </p>
    </div>
  </div>
</template>

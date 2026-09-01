<script setup lang="ts">
import { stepSchemas } from "~~/shared/schemas/onboarding";
import { FormField } from "@/components/ui/field";
import { useOnboardingStore } from "@/store/onboarding";
import {
  CalendarIcon,
  CheckIcon,
  LockIcon,
  Mail,
  MarsIcon,
  User,
  VenusIcon,
} from "@lucide/vue";
import {
  DateFormatter,
  getLocalTimeZone,
  parseDate,
  today,
} from "@internationalized/date";

const store = useOnboardingStore();

const { form, errors, touched, validateField, validateAll } = useZodForm(stepSchemas[1], {
  fullName: store.form.fullName ?? "",
  dateOfBirth: store.form.dateOfBirth ?? "",
  gender: store.form.gender ?? "male",
  email: store.form.email ?? "",
  password: store.form.password ?? "",
  confirmPassword: store.form.confirmPassword ?? "",
});

const fieldValid = (field: keyof typeof form) => {
  return touched[field] && errors[field].length === 0;
};

const dateFormatter = new DateFormatter("en-US", { dateStyle: "long" });

const dateOfBirthValue = computed({
  get: () => (form.dateOfBirth ? parseDate(form.dateOfBirth) : undefined),
  set: (value) => {
    form.dateOfBirth = value ? value.toString() : "";
    validateField("dateOfBirth");
  },
});

defineExpose({
  validate() {
    if (!validateAll()) return false;
    store.mergeStep({ ...form });
    return true;
  },
});
</script>

<template>
  <div
    class="flex flex-col gap-5 rounded-2xl bg-card p-5 **:data-[slot=field-label]:text-xs **:data-[slot=field-label]:uppercase **:data-[slot=field-label]:tracking-wide **:data-[slot=field-label]:text-muted-foreground"
  >
    <FormField
      label="Full name"
      name="fullName"
      :errors="errors.fullName"
      v-slot="{ id, ariaInvalid }"
    >
      <UiInputGroup class="h-auto gap-x-1" :valid="fieldValid('fullName')">
        <UiInputGroupAddon class=""> <User /> </UiInputGroupAddon>
        <UiInputGroupInput
          :id="id"
          class="h-full"
          v-model="form.fullName"
          placeholder="Enter your full name"
          :aria-invalid="ariaInvalid"
          @blur="validateField('fullName')"
        />
        <UiInputGroupAddon v-if="fieldValid('fullName')" align="inline-end">
          <div class="bg-md-tertiary flex size-5 shrink-0 items-center justify-center rounded-full">
            <CheckIcon class="text-md-on-tertiary size-3" />
          </div>
        </UiInputGroupAddon>
      </UiInputGroup>
    </FormField>
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
          placeholder="Enter your password"
          type="password"
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
    <FormField
      label="Confirm Password"
      name="confirmPassword"
      :errors="errors.confirmPassword"
      v-slot="{ id, ariaInvalid }"
    >
      <UiInputGroup class="h-auto gap-x-1" :valid="fieldValid('confirmPassword')">
        <UiInputGroupAddon class=""> <LockIcon /> </UiInputGroupAddon>
        <UiInputGroupInput
          :id="id"
          class="h-full"
          v-model="form.confirmPassword"
          type="password"
          placeholder="Confirm your password"
          :aria-invalid="ariaInvalid"
          @blur="validateField('confirmPassword')"
        />
        <UiInputGroupAddon v-if="fieldValid('confirmPassword')" align="inline-end">
          <div class="bg-md-tertiary flex size-5 shrink-0 items-center justify-center rounded-full">
            <CheckIcon class="text-md-on-tertiary size-3" />
          </div>
        </UiInputGroupAddon>
      </UiInputGroup>
    </FormField>

    <FormField
      label="Date of birth"
      name="dateOfBirth"
      :errors="errors.dateOfBirth"
      v-slot="{ id, ariaInvalid }"
    >
      <UiPopover>
        <UiPopoverTrigger as-child>
          <UiInputGroup
            class="h-auto cursor-pointer gap-x-1"
            :valid="fieldValid('dateOfBirth')"
          >
            <UiInputGroupAddon class=""> <CalendarIcon /> </UiInputGroupAddon>
            <UiInputGroupInput
              :id="id"
              class="h-full cursor-pointer font-mono"
              :model-value="
                dateOfBirthValue
                  ? dateFormatter.format(dateOfBirthValue.toDate(getLocalTimeZone()))
                  : ''
              "
              placeholder="Select your date of birth"
              :aria-invalid="ariaInvalid"
              readonly
            />
          </UiInputGroup>
        </UiPopoverTrigger>
        <UiPopoverContent class="w-auto p-0">
          <UiCalendar
            v-model="dateOfBirthValue"
            layout="month-and-year"
            :max-value="today(getLocalTimeZone())"
          />
        </UiPopoverContent>
      </UiPopover>
    </FormField>

    <FormField label="Sex" name="gender" :errors="errors.gender">
      <div class="grid grid-cols-2 gap-3">
        <button
          v-for="option in (['male', 'female'] as const)"
          :key="option"
          type="button"
          class="rounded-xl min-h-22 gap-y-2 flex flex-col items-center justify-center border border-border py-3 text-sm font-medium capitalize transition-colors"
          :class="
            form.gender === option
              ? 'bg-foreground text-background'
              : 'bg-muted text-muted-foreground'
          "
          @click="
            form.gender = option;
            validateField('gender');
          "
        >
          <MarsIcon v-if="option === 'male'" />
          <VenusIcon v-if="option === 'female'" />
          {{ option }}
        </button>
      </div>
    </FormField>
  </div>
</template>

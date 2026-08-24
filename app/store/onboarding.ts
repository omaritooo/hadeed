import { onboardingSchema, type OnboardingForm } from '~~/shared/schemas/onboarding'

export const useOnboardingStore = defineStore('onboarding', () => {
    const form = reactive<Partial<OnboardingForm>>({})

    const mergeStep = (data: Partial<OnboardingForm>) => {
        Object.assign(form, data)
    }

    const resetForm = () => {
        for (const key of Object.keys(form) as (keyof OnboardingForm)[]) form[key] = undefined
    }

    const submitForm = () => {
        return onboardingSchema.parse(form)
    }

    return { form, mergeStep, resetForm, submitForm }
})

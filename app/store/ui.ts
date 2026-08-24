import {defineStore} from 'pinia'

export const useUiStore = defineStore('ui', () => {
    const onboardingStep = ref(1)
    const stepMover = (state: 'prev' | 'next') => {
        if (state === 'prev') {
            onboardingStep.value--
        }
        else {
            onboardingStep.value++
        }
    }

    return { onboardingStep, stepMover }
})
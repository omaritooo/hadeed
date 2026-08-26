import { z } from 'zod'

const baseOnboardingSchema = z.object({
  fullName: z.string().min(1, 'Full name is required.'),
  dateOfBirth: z.iso.date('Enter a valid date of birth.'),
  gender: z.enum(['male', 'female'], { message: 'Select an option.' }),
  email: z.email('Enter a valid email address.'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(16, 'Password must be at most 16 characters.'),
  confirmPassword: z.string().min(1, 'Confirm your password.'),
  experienceLevel: z.enum(['beginner', 'intermediate', 'advanced']),
  primaryGoal: z.enum(['muscle_gain', 'fat_loss', 'maintenance', 'general_fitness']),
  activityLevel: z.enum(['sedentary', 'lightly_active', 'very_active']),
  weight: z.number().min(30),
  height: z.number().min(110),
  equipment: z.enum(['gym', 'home', 'both']),
  frequency: z.number().min(1).max(6),
  targetWeight: z.number().min(30).optional(),
})

export const onboardingSchema = baseOnboardingSchema.refine(
  data => data.password === data.confirmPassword,
  { message: 'Passwords do not match.', path: ['confirmPassword'] },
)

export type OnboardingForm = z.infer<typeof baseOnboardingSchema>

export const stepSchemas = {
  1: baseOnboardingSchema.pick({ fullName: true, dateOfBirth: true, gender: true, password: true, confirmPassword: true, email: true }),
  2: baseOnboardingSchema.pick({experienceLevel: true, activityLevel: true}),
  3: baseOnboardingSchema.pick({primaryGoal: true}),
  4: baseOnboardingSchema.pick({ weight: true, height: true, targetWeight: true }),
  5: baseOnboardingSchema.pick({equipment: true, frequency: true})
} as const

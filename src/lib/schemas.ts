import { z } from 'zod';

// Mirrors the server-side checks in validate_contact() — the server re-checks everything.
export const phoneRegex = /^\+?[0-9]{7,15}$/;
const normalizePhone = (v: string) => v.replace(/[\s\-()]/g, '');

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your full name.').max(120, 'Name is too long.'),
  email: z.string().trim().email('Please enter a valid email address.').max(254),
  phone: z.string().trim().refine((v) => phoneRegex.test(normalizePhone(v)), 'Please enter a valid mobile number, e.g. 0917 123 4567.'),
  notes: z.string().max(500, 'Notes must be 500 characters or fewer.').optional(),
});

export const paymentReferenceRegex = /^[A-Za-z0-9\-_ ]{4,64}$/;

export const checkoutSchema = contactSchema.extend({
  paymentMethod: z.enum(['cash', 'bank_transfer', 'gcash', 'gateway'], { message: 'Choose how you will pay.' }),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Please agree to the booking policy and privacy policy to confirm your booking.' }) }),
});
// The receipt photo is a file, validated by the checkout page itself.
export type CheckoutValues = z.input<typeof checkoutSchema>;
export type CheckoutOutput = z.output<typeof checkoutSchema>;

export const passwordSchema = z.string().min(8, 'Use at least 8 characters.').max(72, 'Use at most 72 characters.');

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter your full name.').max(120),
  email: z.string().trim().email('Please enter a valid email address.'),
  mobile: z.string().trim().refine((v) => phoneRegex.test(normalizePhone(v)), 'Please enter a valid mobile number.'),
  password: passwordSchema,
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { message: 'Passwords do not match.', path: ['confirm'] });
export type RegisterValues = z.infer<typeof registerSchema>;

export const profileSchema = z.object({
  full_name: z.string().trim().min(2, 'Please enter your full name.').max(120),
  mobile_number: z.string().trim().refine((v) => phoneRegex.test(normalizePhone(v)), 'Please enter a valid mobile number.'),
});
export type ProfileValues = z.infer<typeof profileSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.'),
  password: z.string().min(1, 'Please enter your password.'),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const paymentSubmissionSchema = z.object({
  method: z.enum(['bank_transfer', 'gcash']),
  reference: z.string().trim().regex(paymentReferenceRegex, 'Enter the reference number from your receipt (4–64 letters or digits).'),
  amount: z.coerce.number().positive('Enter the amount you paid.'),
});
export type PaymentSubmissionValues = z.input<typeof paymentSubmissionSchema>;
export type PaymentSubmissionOutput = z.output<typeof paymentSubmissionSchema>;

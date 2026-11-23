import { describe, expect, it } from 'vitest';
import { checkoutSchema, paymentSubmissionSchema, registerSchema } from './schemas';
import { money } from './format';

const base = { name: 'Ana Cruz', email: 'ana@example.com', phone: '0917 123 4567', notes: '', paymentMethod: 'gcash', acceptTerms: true };

describe('checkoutSchema', () => {
  it('accepts a valid checkout', () => {
    expect(checkoutSchema.safeParse(base).success).toBe(true);
  });
  it('accepts Philippine and international mobile formats', () => {
    for (const phone of ['09171234567', '+63 917 123 4567', '(02) 8123-4567', '+1-212-555-0100']) {
      expect(checkoutSchema.safeParse({ ...base, phone }).success, phone).toBe(true);
    }
  });
  it('rejects bad contact details', () => {
    expect(checkoutSchema.safeParse({ ...base, name: 'A' }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, email: 'nope' }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, phone: '12' }).success).toBe(false);
  });
  it('requires agreeing to the policy', () => {
    const r = checkoutSchema.safeParse({ ...base, acceptTerms: false });
    expect(r.success).toBe(false);
  });
});

describe('other schemas', () => {
  it('requires matching passwords on registration', () => {
    const v = { fullName: 'Ana Cruz', email: 'ana@example.com', mobile: '09171234567', password: 'longenough', confirm: 'different' };
    expect(registerSchema.safeParse(v).success).toBe(false);
    expect(registerSchema.safeParse({ ...v, confirm: 'longenough' }).success).toBe(true);
  });
  it('validates payment references like the server does', () => {
    expect(paymentSubmissionSchema.safeParse({ method: 'gcash', reference: '1234 5678', amount: '650' }).success).toBe(true);
    expect(paymentSubmissionSchema.safeParse({ method: 'gcash', reference: 'x', amount: '650' }).success).toBe(false);
    expect(paymentSubmissionSchema.safeParse({ method: 'gcash', reference: 'ABC123', amount: '0' }).success).toBe(false);
  });
});

describe('money', () => {
  it('formats pesos with two decimals', () => {
    expect(money(650, 'PHP')).toMatch(/^₱\s?650\.00$/);
    expect(money('1150.5', 'PHP')).toMatch(/1,150\.50/);
  });
});

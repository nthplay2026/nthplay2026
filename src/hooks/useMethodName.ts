import { useCallback } from 'react';
import { useFacility } from '@/hooks/useFacility';
import { methodName } from '@/lib/format';
import type { PaymentMethod } from '@/lib/types';

/** Returns a function giving each payment method's current name (renamable in Settings > Payment methods). */
export function useMethodName() {
  const { settings } = useFacility();
  const methods = settings?.payment_methods;
  return useCallback((m: PaymentMethod | null | undefined) => methodName(m, methods), [methods]);
}

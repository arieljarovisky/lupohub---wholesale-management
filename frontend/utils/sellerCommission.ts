import { Customer, User } from '../types';

const IVA_DIVISOR = 1.21;

export const roundMoney2 = (n: number) => Math.round(n * 100) / 100;
export const netWithoutIva = (gross: number) => gross / IVA_DIVISOR;

/** % efectivo: override del cliente, si no el % del vendedor, si no 0. */
export function effectiveCommissionRate(customer: Customer | undefined, seller: User): number {
  if (
    customer?.sellerCommissionPercentage != null &&
    Number.isFinite(customer.sellerCommissionPercentage)
  ) {
    return Math.min(100, Math.max(0, customer.sellerCommissionPercentage));
  }
  const sellerRate = seller.commissionPercentage;
  if (sellerRate != null && Number.isFinite(sellerRate)) {
    return Math.min(100, Math.max(0, sellerRate));
  }
  return 0;
}

export function commissionFromGross(gross: number, ratePercent: number): number {
  return roundMoney2(netWithoutIva(gross) * (ratePercent / 100));
}

export function commissionRateLabelForCustomers(custs: Customer[], seller: User): string {
  if (custs.length === 0) {
    const d = effectiveCommissionRate(undefined, seller);
    return `${d}%`;
  }
  const rates = custs.map((c) => effectiveCommissionRate(c, seller));
  const minR = Math.min(...rates);
  const maxR = Math.max(...rates);
  if (Math.abs(minR - maxR) < 0.001) return `${roundMoney2(minR)}%`;
  return `${roundMoney2(minR)}–${roundMoney2(maxR)}%`;
}

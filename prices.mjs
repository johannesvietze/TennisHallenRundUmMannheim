export function euroCents(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function withCourtPrices(slot, courtPrices) {
  return courtPrices.some(price => price != null) ? { ...slot, courtPrices } : slot;
}

export function hourlyPrice(rates, start) {
  const end = start + 60;
  const overlapping = rates.filter(rate => rate.start < end && rate.end > start && rate.end > rate.start)
    .sort((a, b) => a.start - b.start);
  const price = overlapping[0]?.cents ?? null;
  let covered = start;
  for (const rate of overlapping) {
    if (rate.cents !== price || rate.start > covered) return null;
    covered = Math.max(covered, rate.end);
  }
  return covered >= end ? price : null;
}

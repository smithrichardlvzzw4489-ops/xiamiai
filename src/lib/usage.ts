export function utcDayString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export const DAILY_FREE_LIMIT = 5;

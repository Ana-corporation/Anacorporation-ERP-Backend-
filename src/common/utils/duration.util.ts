/** Parse duration strings like 15m, 7d, 1h into seconds. */
export function parseDurationToSeconds(value: string, fallbackSeconds = 604800): number {
  const trimmed = value.trim();
  const match = /^(\d+)([smhd])$/i.exec(trimmed);
  if (!match) return fallbackSeconds;

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    case 'd':
      return amount * 86400;
    default:
      return fallbackSeconds;
  }
}

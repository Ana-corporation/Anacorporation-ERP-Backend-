import { parseDurationToSeconds } from './duration.util';

describe('duration.util', () => {
  it('parses minutes', () => {
    expect(parseDurationToSeconds('15m')).toBe(900);
  });

  it('parses days', () => {
    expect(parseDurationToSeconds('7d')).toBe(604800);
  });
});

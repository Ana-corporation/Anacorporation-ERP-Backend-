import { normalizePhoneNumber, isValidPhoneNumber } from './phone.util';

describe('phone.util', () => {
  it('accepts valid India mobile and returns E.164', () => {
    expect(normalizePhoneNumber('+919994555458')).toBe('+919994555458');
    expect(normalizePhoneNumber('9994555458')).toBe('+919994555458');
  });

  it('rejects India mobile with too many digits', () => {
    expect(normalizePhoneNumber('+91999455545881')).toBeNull();
    expect(isValidPhoneNumber('+91999455545881')).toBe(false);
  });

  it('accepts US / UK numbers with country code', () => {
    expect(normalizePhoneNumber('+14155552671')).toBe('+14155552671');
    expect(normalizePhoneNumber('+442071838750')).toBe('+442071838750');
  });

  it('rejects empty / garbage', () => {
    expect(normalizePhoneNumber('')).toBeNull();
    expect(normalizePhoneNumber('   ')).toBeNull();
    expect(normalizePhoneNumber('not-a-phone')).toBeNull();
  });
});

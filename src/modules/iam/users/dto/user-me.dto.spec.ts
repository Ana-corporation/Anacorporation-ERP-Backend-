import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '@/common/exceptions/business.exception';
import {
  PatchSelfProfileSchema,
  rejectForbiddenSelfPatchKeys,
} from './user-me.dto';

describe('self profile DTO', () => {
  it('accepts displayName and phone only', () => {
    expect(PatchSelfProfileSchema.parse({ displayName: 'Priya K' })).toEqual({
      displayName: 'Priya K',
    });
  });

  it('rejects admin-only keys', () => {
    expect(() => PatchSelfProfileSchema.parse({ roleId: 1 })).toThrow();
    expect(() => rejectForbiddenSelfPatchKeys({ roleId: 1 })).toThrow(BusinessException);
    try {
      rejectForbiddenSelfPatchKeys({ roleId: 1, email: 'x' });
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    }
  });
});

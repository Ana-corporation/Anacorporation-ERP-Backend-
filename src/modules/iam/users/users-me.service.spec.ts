import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '@/common/exceptions/business.exception';
import { UsersMeService } from './users-me.service';

describe('UsersMeService', () => {
  it('rejects PATCH of roleId on self profile', async () => {
    const service = new UsersMeService(
      { getMyProfile: jest.fn() } as never,
      { updateSelfProfile: jest.fn() } as never,
      {} as never,
      {} as never,
      { invalidate: jest.fn() } as never,
      { log: jest.fn() } as never,
    );

    await expect(
      service.patchProfile('12', '15', { displayName: 'Priya K' } as never, { roleId: 1 }),
    ).rejects.toBeInstanceOf(BusinessException);

    try {
      await service.patchProfile('12', '15', { displayName: 'Priya K' } as never, { roleId: 1 });
    } catch (error) {
      expect((error as BusinessException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    }
  });

  it('updates displayName for self only', async () => {
    const updateSelfProfile = jest.fn().mockResolvedValue({});
    const getMyProfile = jest.fn().mockResolvedValue({
      user: { displayName: 'Priya K' },
      membership: null,
      role: null,
    });
    const service = new UsersMeService(
      { getMyProfile } as never,
      { updateSelfProfile } as never,
      {} as never,
      {} as never,
      { invalidate: jest.fn() } as never,
      { log: jest.fn() } as never,
    );

    const result = await service.patchProfile(
      '12',
      '15',
      { displayName: 'Priya K' } as never,
      { displayName: 'Priya K' },
    );

    expect(updateSelfProfile).toHaveBeenCalledWith('12', { displayName: 'Priya K' }, '12');
    expect(result.user.displayName).toBe('Priya K');
  });
});

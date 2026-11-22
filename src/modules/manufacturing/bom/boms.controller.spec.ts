import { PERMISSIONS_KEY } from '@/common/constants/metadata.constants';
import { BomsController } from './boms.controller';

describe('BomsController permissions', () => {
  const proto = BomsController.prototype as unknown as Record<string, object>;
  const permissions = (name: string) => Reflect.getMetadata(PERMISSIONS_KEY, proto[name]);

  it('release / revise / obsolete are separate from edit', () => {
    expect(permissions('list')).toEqual(['boms:view']);
    expect(permissions('get')).toEqual(['boms:view']);
    expect(permissions('whereUsed')).toEqual(['boms:view']);
    expect(permissions('byItem')).toEqual(['boms:view']);
    expect(permissions('validate')).toEqual(['boms:view']);
    expect(permissions('requirements')).toEqual(['boms:view']);
    expect(permissions('revisions')).toEqual(['boms:view']);
    expect(permissions('create')).toEqual(['boms:create']);
    expect(permissions('update')).toEqual(['boms:edit']);
    expect(permissions('addMain')).toEqual(['boms:edit']);
    expect(permissions('addSub')).toEqual(['boms:edit']);
    expect(permissions('updateLine')).toEqual(['boms:edit']);
    expect(permissions('deleteLine')).toEqual(['boms:edit']);
    expect(permissions('cancel')).toEqual(['boms:edit']);
    expect(permissions('remove')).toEqual(['boms:delete']);
    expect(permissions('release')).toEqual(['boms:release']);
    expect(permissions('revise')).toEqual(['boms:revise']);
    expect(permissions('obsolete')).toEqual(['boms:obsolete']);
  });
});

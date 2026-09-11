import {
  avatarLooksLikeMime,
  resolveAvatarMime,
} from './user-avatar.constants';

describe('user-avatar.constants', () => {
  it('rejects svg and non-image types', () => {
    expect(resolveAvatarMime('photo.svg', 'image/svg+xml')).toBeNull();
    expect(resolveAvatarMime('script.js', 'application/javascript')).toBeNull();
    expect(resolveAvatarMime('photo.jpg', 'image/jpeg')).toBe('image/jpeg');
    expect(resolveAvatarMime('photo.webp', '')).toBe('image/webp');
  });

  it('checks jpeg/png/webp magic bytes', () => {
    expect(avatarLooksLikeMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg')).toBe(true);
    expect(avatarLooksLikeMime(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png')).toBe(true);
    expect(avatarLooksLikeMime(Buffer.from('XXXXXXXXXXXX', 'ascii'), 'image/webp')).toBe(false);
    const webp = Buffer.alloc(12);
    webp.write('RIFF', 0);
    webp.write('WEBP', 8);
    expect(avatarLooksLikeMime(webp, 'image/webp')).toBe(true);
  });
});

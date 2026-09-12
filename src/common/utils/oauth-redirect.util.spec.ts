import { BadRequestException } from '@nestjs/common';
import { assertAllowedRedirectUri } from './oauth-redirect.util';

describe('assertAllowedRedirectUri', () => {
  it('allows URIs on the allow-list', () => {
    expect(() =>
      assertAllowedRedirectUri('http://localhost:3001/callback', [
        'http://localhost:3001/callback',
      ]),
    ).not.toThrow();
  });

  it('rejects URIs not on the allow-list', () => {
    expect(() =>
      assertAllowedRedirectUri('https://evil.example/steal', [
        'http://localhost:3001/callback',
      ]),
    ).toThrow(BadRequestException);
  });

  it('rejects when allow-list is empty', () => {
    expect(() => assertAllowedRedirectUri('http://localhost:3001/callback', [])).toThrow(
      BadRequestException,
    );
  });
});

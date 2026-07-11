export const SUPER_ADMIN_REFRESH_TOKEN_COOKIE = 'super_admin_refresh_token';

export const SUPER_ADMIN_REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/v1/super-admins/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const SUPER_ADMIN_DEFAULT_REDIRECT = '/super-admin/dashboard';

import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { pl } from '../i18n/pl';
import { defaultPath } from '../navigation';
import { authErrorMessage, loginPath, safeNextPath } from './auth';

describe('safeNextPath', () => {
  it('keeps in-app paths', () => {
    expect(safeNextPath('/races')).toBe('/races');
    expect(safeNextPath('/activities?sport=trail_run')).toBe('/activities?sport=trail_run');
  });

  it('falls back to the default page for missing, external or login targets', () => {
    for (const next of [
      null,
      undefined,
      '',
      'races',
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      '/login',
      '/login?next=/races',
    ]) {
      expect(safeNextPath(next)).toBe(defaultPath);
    }
  });
});

describe('loginPath', () => {
  it('carries the requested page', () => {
    expect(loginPath('/races?x=1')).toBe('/login?next=%2Fraces%3Fx%3D1');
    expect(loginPath('/')).toBe('/login');
  });
});

describe('authErrorMessage', () => {
  it('maps API statuses to Polish messages', () => {
    expect(authErrorMessage(new ApiError(401, 'x'))).toBe(pl.auth.errors.invalidPassword);
    expect(authErrorMessage(new ApiError(403, 'x'))).toBe(pl.auth.errors.invalidPassword);
    expect(authErrorMessage(new ApiError(429, 'x'))).toBe(pl.auth.errors.tooManyAttempts);
    expect(authErrorMessage(new ApiError(503, 'x'))).toBe(pl.auth.errors.notConfigured);
    expect(authErrorMessage(new ApiError(0, 'x'))).toBe(pl.auth.errors.network);
    expect(authErrorMessage(new ApiError(500, 'x'))).toBe(pl.auth.errors.generic);
    expect(authErrorMessage(new Error('x'))).toBe(pl.auth.errors.generic);
  });
});

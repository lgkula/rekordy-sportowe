declare const __APP_VERSION__: string | undefined;

/** Injected at build time by tsup (`<package version>+<git sha>`); `dev` when running from source. */
export const appVersion: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/**
 * FIT parsing, a separate entry point (`@rekordy/core/fit`): the Garmin SDK profile is
 * large, so only the import code (a Web Worker on the web, the import routes on the
 * server) loads it.
 */
export * from './parseFit';

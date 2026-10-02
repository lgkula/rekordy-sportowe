// Startup file for the hosting panel (CloudLinux Node.js Selector / Phusion Passenger).
// Panel setting "Plik startowy aplikacji": app.js. Passenger loads this file and takes over listen().
'use strict';

// Stack traces in logs point to the TypeScript sources (dist/*.cjs.map).
process.setSourceMapsEnabled(true);
require('./dist/server.cjs');

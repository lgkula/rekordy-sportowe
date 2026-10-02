#!/usr/bin/env node
/**
 * Writes anonymised copies of FIT activity files for the test fixtures.
 *
 * Usage: node scripts/anonymize-fit.mjs <input.fit> <output.fit> [...more pairs]
 *
 * Kept: what the parser reads (file_id, sport, session/lap/activity totals, timer events,
 * record timestamp/distance/altitude/speed). Dropped: GPS positions, heart rate, power,
 * user profile, device info, workouts, courses and everything else. The watch serial
 * number is replaced; `time_created` keeps the external ID unique per file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Decoder, Encoder, Profile, Stream } from '@garmin/fitsdk';

const FAKE_SERIAL = 1000000001;

/** Fields kept per message type (by profile name); messages not listed are dropped. */
const KEEP = {
  fileId: ['type', 'manufacturer', 'product', 'serialNumber', 'timeCreated'],
  fileCreator: ['softwareVersion'],
  event: ['timestamp', 'event', 'eventType', 'data', 'eventGroup'],
  sport: ['sport', 'subSport', 'name'],
  session: [
    'messageIndex',
    'timestamp',
    'event',
    'eventType',
    'startTime',
    'sport',
    'subSport',
    'sportProfileName',
    'totalElapsedTime',
    'totalTimerTime',
    'totalDistance',
    'totalAscent',
    'totalDescent',
    'firstLapIndex',
    'numLaps',
    'trigger',
    'enhancedAvgSpeed',
  ],
  lap: [
    'messageIndex',
    'timestamp',
    'event',
    'eventType',
    'startTime',
    'totalElapsedTime',
    'totalTimerTime',
    'totalDistance',
    'totalAscent',
    'totalDescent',
    'lapTrigger',
    'sport',
    'subSport',
  ],
  activity: [
    'timestamp',
    'totalTimerTime',
    'numSessions',
    'type',
    'event',
    'eventType',
    'localTimestamp',
  ],
  record: ['timestamp', 'distance', 'enhancedAltitude', 'enhancedSpeed'],
};

const nameByNum = new Map(
  Object.entries(Profile.messages).map(([num, mesg]) => [Number(num), mesg.name]),
);

function anonymize(input) {
  const encoder = new Encoder();
  const decoder = new Decoder(Stream.fromBuffer(input));
  const { errors } = decoder.read({
    mergeHeartRates: false,
    mesgListener: (mesgNum, mesg) => {
      const fields = KEEP[nameByNum.get(mesgNum)];
      if (!fields) return;
      const out = { mesgNum };
      for (const field of fields) if (mesg[field] !== undefined) out[field] = mesg[field];
      if (out.serialNumber !== undefined) out.serialNumber = FAKE_SERIAL;
      encoder.writeMesg(out);
    },
  });
  if (errors.length > 0) throw errors[0];
  return encoder.close();
}

const args = process.argv.slice(2);
if (args.length === 0 || args.length % 2 !== 0) {
  console.error('Usage: node scripts/anonymize-fit.mjs <input.fit> <output.fit> [...]');
  process.exit(1);
}
for (let i = 0; i < args.length; i += 2) {
  const output = anonymize(readFileSync(args[i]));
  writeFileSync(args[i + 1], output);
  console.log(`${args[i]} -> ${args[i + 1]} (${output.byteLength} bytes)`);
}

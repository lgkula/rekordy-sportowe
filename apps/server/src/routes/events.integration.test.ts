import path from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ActivityCreateInput,
  ActivityDetail,
  EventDetail,
  EventListItem,
  EventListResponse,
  EventSuggestion,
  Sport,
} from '@rekordy/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { Database } from '../db/client';
import { loginHeaders, testAuth } from '../test/auth';
import { clearActivityData, openTestDatabase, testDbName } from '../test/db';

describe.skipIf(!testDbName)('/api/events, /api/settings', () => {
  let database: Database;
  let app: FastifyInstance;
  let editor: { cookie: string };
  let viewer: { cookie: string };
  let day = 0;

  /** A race from totals only; `durationS` over `distanceM` gives its pace. */
  function race(overrides: Partial<ActivityCreateInput> & Record<string, unknown> = {}) {
    day++;
    return {
      mode: 'full',
      sport: 'road_run',
      name: `Zawody ${day}`,
      localDate: `2025-${String(1 + (day % 12)).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      distanceM: 10000,
      durationS: 2700,
      isRace: true,
      ...overrides,
    } as ActivityCreateInput;
  }

  async function createActivity(body: ActivityCreateInput): Promise<ActivityDetail> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/activities',
      headers: editor,
      payload: { ...body, confirmDuplicate: true },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<ActivityDetail>();
  }

  async function createEvent(
    name: string,
    extra: Record<string, unknown> = {},
    sport: Sport = 'road_run',
  ): Promise<EventDetail> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: editor,
      payload: { sport, name, ...extra },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<EventDetail>();
  }

  async function list(sport: Sport = 'road_run', headers = editor): Promise<EventListResponse> {
    const res = await app.inject({ url: `/api/events?sport=${sport}`, headers });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<EventListResponse>();
  }

  async function getEvent(id: number): Promise<EventDetail> {
    const res = await app.inject({ url: `/api/events/${id}`, headers: editor });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<EventDetail>();
  }

  async function patchActivity(id: number, payload: Record<string, unknown>) {
    return app.inject({ method: 'PATCH', url: `/api/activities/${id}`, headers: editor, payload });
  }

  function names(items: EventListItem[]): string[] {
    return items.map((i) => i.name);
  }

  beforeAll(async () => {
    database = await openTestDatabase();
    app = await buildApp({
      webDir: path.join(tmpdir(), 'rekordy-no-web'),
      health: {
        checkDb: async () => {},
        migrationStatus: async () => ({ total: 0, applied: 0, pending: [] }),
        checkStorage: async () => true,
      },
      auth: testAuth(),
      db: database.db,
    });
    editor = await loginHeaders(app, 'editor');
    viewer = await loginHeaders(app, 'viewer');
  });

  beforeEach(async () => {
    await clearActivityData(database);
    await database.pool.query('DELETE FROM `settings`');
    day = 0;
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  describe('access', () => {
    it('needs a session to read', async () => {
      expect((await app.inject('/api/events?sport=road_run')).statusCode).toBe(401);
      expect((await app.inject('/api/settings/events.ordering.road_run')).statusCode).toBe(401);
    });

    it('lets a viewer read but not change anything', async () => {
      const event = await createEvent('Bieg Niepodległości');
      expect((await list('road_run', viewer)).events).toHaveLength(1);
      const read = await app.inject({ url: `/api/events/${event.id}`, headers: viewer });
      expect(read.statusCode).toBe(200);
      const attempts = [
        { method: 'POST', url: '/api/events', payload: { sport: 'road_run', name: 'X' } },
        { method: 'PATCH', url: `/api/events/${event.id}`, payload: { name: 'X' } },
        { method: 'DELETE', url: `/api/events/${event.id}` },
        { method: 'POST', url: `/api/events/${event.id}/merge`, payload: { targetId: 1 } },
        { method: 'PUT', url: '/api/events/order', payload: { sport: 'road_run', ids: [] } },
        {
          method: 'PUT',
          url: '/api/settings/events.ordering.road_run',
          payload: { value: 'name' },
        },
      ] as const;
      for (const attempt of attempts) {
        const res = await app.inject({ ...attempt, headers: viewer });
        expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(403);
      }
    });
  });

  describe('aggregation', () => {
    it('groups two editions into one event with the best pace of both', async () => {
      const event = await createEvent('Bieg Niepodległości');
      const slow = await createActivity(
        race({ eventId: event.id, editionLabel: '2024', localDate: '2024-11-11', durationS: 2800 }),
      );
      const fast = await createActivity(
        race({ eventId: event.id, editionLabel: '2025', localDate: '2025-11-11', durationS: 2650 }),
      );

      const { events } = await list();
      expect(events).toHaveLength(1);
      const [item] = events;
      expect(item).toMatchObject({
        key: `e${event.id}`,
        name: 'Bieg Niepodległości',
        editionCount: 2,
        bestPaceSPerKm: 265,
        distanceM: 10000,
        latestDate: '2025-11-11',
        elevationGainM: null,
      });
      expect(item!.bestEdition).toMatchObject({ activityId: fast.id, editionLabel: '2025' });

      const detail = await getEvent(event.id);
      expect(detail.editions.map((e) => e.activityId)).toEqual([fast.id, slow.id]);
      expect(detail.editions[1]).toMatchObject({
        editionLabel: '2024',
        localDate: '2024-11-11',
        durationS: 2800,
        distanceM: 10000,
        paceSPerKm: 280,
      });
    });

    it('takes the elevation gain of the best-pace edition for trail runs', async () => {
      const event = await createEvent('Bieg na Ślężę', {}, 'trail_run');
      await createActivity(
        race({ sport: 'trail_run', eventId: event.id, durationS: 3600, elevationGainM: 700 }),
      );
      await createActivity(
        race({ sport: 'trail_run', eventId: event.id, durationS: 3300, elevationGainM: 640 }),
      );
      const [item] = (await list('trail_run')).events;
      expect(item).toMatchObject({ bestPaceSPerKm: 330, elevationGainM: 640 });
    });

    it('shows hidden editions without counting them', async () => {
      const event = await createEvent('Parkrun');
      const hidden = await createActivity(
        race({ eventId: event.id, durationS: 2000, isHidden: true }),
      );
      const visible = await createActivity(race({ eventId: event.id, durationS: 2900 }));
      const [item] = (await list()).events;
      expect(item).toMatchObject({ editionCount: 2, bestPaceSPerKm: 290 });
      expect(item!.bestEdition?.activityId).toBe(visible.id);
      const detail = await getEvent(event.id);
      expect(detail.editions.find((e) => e.activityId === hidden.id)?.isHidden).toBe(true);
    });

    it('uses the manual distance and goes back to the computed one', async () => {
      const event = await createEvent('Cross');
      await createActivity(race({ eventId: event.id, distanceM: 10080 }));
      await createActivity(race({ eventId: event.id, distanceM: 10120 }));
      expect((await list()).events[0]).toMatchObject({
        distanceM: 10100,
        computedDistanceM: 10100,
        displayDistanceM: null,
      });

      let res = await app.inject({
        method: 'PATCH',
        url: `/api/events/${event.id}`,
        headers: editor,
        payload: { displayDistanceM: 10000 },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<EventDetail>()).toMatchObject({ distanceM: 10000, displayDistanceM: 10000 });

      res = await app.inject({
        method: 'PATCH',
        url: `/api/events/${event.id}`,
        headers: editor,
        payload: { displayDistanceM: null },
      });
      expect(res.json<EventDetail>()).toMatchObject({ distanceM: 10100, displayDistanceM: null });
    });

    it('lists races without an event as one-edition events', async () => {
      await createEvent('Bieg Niepodległości');
      const loose = await createActivity(race({ name: 'Bieg o Puchar Wójta' }));
      await createActivity(race({ isRace: false, name: 'Trening' }));
      await createActivity(race({ sport: 'trail_run', name: 'Inny sport' }));

      const { events } = await list();
      expect(names(events)).toEqual(['Bieg Niepodległości', 'Bieg o Puchar Wójta']);
      expect(events[1]).toMatchObject({
        key: `a${loose.id}`,
        id: null,
        activityId: loose.id,
        editionCount: 1,
        bestPaceSPerKm: 270,
      });
    });
  });

  describe('assignment', () => {
    it('creates a new event with the activity and reuses it by name', async () => {
      const first = await createActivity(race({ newEventName: 'Półmaraton Opolski' }));
      const second = await createActivity(race({ newEventName: ' półmaraton  opolski ' }));
      expect(first.eventId).not.toBeNull();
      expect(second.eventId).toBe(first.eventId);
      expect(first.eventName).toBe('Półmaraton Opolski');
      const { events } = await list();
      expect(events).toHaveLength(1);
      expect(events[0]!.editionCount).toBe(2);
    });

    it('marks an activity assigned to an event as a race', async () => {
      const event = await createEvent('Parkrun');
      const activity = await createActivity(race({ isRace: false, eventId: event.id }));
      expect(activity.isRace).toBe(true);
    });

    it('rejects an event of another sport or a missing one', async () => {
      const trail = await createEvent('Górski', {}, 'trail_run');
      for (const eventId of [trail.id, 999_999]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/activities',
          headers: editor,
          payload: { ...race({ eventId }), confirmDuplicate: true },
        });
        expect(res.statusCode, res.body).toBe(400);
      }
      const activity = await createActivity(race());
      const res = await patchActivity(activity.id, { eventId: trail.id });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ issues: { code: string }[] }>().issues[0]?.code).toBe(
        'event_not_for_sport',
      );
    });

    it('moves an edition to another event and edits its label and notes', async () => {
      const a = await createEvent('A');
      const b = await createEvent('B');
      const activity = await createActivity(race({ eventId: a.id }));
      const res = await patchActivity(activity.id, {
        eventId: b.id,
        editionLabel: 'jesień',
        notes: 'Mocny wiatr',
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<ActivityDetail>()).toMatchObject({
        eventId: b.id,
        eventName: 'B',
        editionLabel: 'jesień',
        notes: 'Mocny wiatr',
      });
      expect((await getEvent(a.id)).editions).toHaveLength(0);
      expect((await getEvent(b.id)).editions[0]?.editionLabel).toBe('jesień');
    });

    it('leaves the event when the activity is no longer a race', async () => {
      const event = await createEvent('A');
      const activity = await createActivity(race({ eventId: event.id }));
      const res = await patchActivity(activity.id, { isRace: false });
      expect(res.json<ActivityDetail>()).toMatchObject({ isRace: false, eventId: null });
    });

    it('keeps the event on unrelated edits and detaches with eventId null', async () => {
      const event = await createEvent('A');
      const activity = await createActivity(race({ eventId: event.id }));
      let res = await patchActivity(activity.id, { isHidden: true });
      expect(res.json<ActivityDetail>().eventId).toBe(event.id);
      res = await patchActivity(activity.id, { eventId: null });
      expect(res.json<ActivityDetail>()).toMatchObject({ eventId: null, isRace: true });
    });

    it('creates an event from an unassigned race', async () => {
      const activity = await createActivity(race({ name: 'Bieg o Puchar Wójta' }));
      const event = await createEvent('Bieg o Puchar Wójta', { activityIds: [activity.id] });
      expect(event.editions.map((e) => e.activityId)).toEqual([activity.id]);
      expect(names((await list()).events)).toEqual(['Bieg o Puchar Wójta']);

      const res = await app.inject({
        method: 'POST',
        url: '/api/events',
        headers: editor,
        payload: { sport: 'trail_run', name: 'X', activityIds: [activity.id] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('editing events', () => {
    it('merges one event into another', async () => {
      const a = await createEvent('Bieg Niepodległości');
      const b = await createEvent('XV Bieg Niepodleglosci');
      await createActivity(race({ eventId: a.id }));
      await createActivity(race({ eventId: b.id }));
      const res = await app.inject({
        method: 'POST',
        url: `/api/events/${b.id}/merge`,
        headers: editor,
        payload: { targetId: a.id },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<EventDetail>().editions).toHaveLength(2);
      expect((await app.inject({ url: `/api/events/${b.id}`, headers: editor })).statusCode).toBe(
        404,
      );
    });

    it('refuses to merge across sports or into itself', async () => {
      const road = await createEvent('A');
      const trail = await createEvent('B', {}, 'trail_run');
      for (const [id, targetId] of [
        [road.id, trail.id],
        [road.id, road.id],
      ] as const) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/events/${id}/merge`,
          headers: editor,
          payload: { targetId },
        });
        expect(res.statusCode).toBe(400);
      }
    });

    it('deletes an event and keeps its races as unassigned', async () => {
      const event = await createEvent('A');
      const activity = await createActivity(race({ eventId: event.id, name: 'Zawody A' }));
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/events/${event.id}`,
        headers: editor,
      });
      expect(res.statusCode).toBe(204);
      const { events } = await list();
      expect(events.map((e) => e.key)).toEqual([`a${activity.id}`]);
    });
  });

  describe('ordering', () => {
    it('keeps the manual order and appends new events', async () => {
      const a = await createEvent('Zawody');
      const b = await createEvent('Łódź Maraton');
      const c = await createEvent('Lublin');
      expect((await list()).ordering).toBe('manual');
      expect(names((await list()).events)).toEqual(['Zawody', 'Łódź Maraton', 'Lublin']);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/events/order',
        headers: editor,
        payload: { sport: 'road_run', ids: [c.id, a.id, b.id] },
      });
      expect(res.statusCode, res.body).toBe(204);
      await createEvent('Śnieżka');
      expect(names((await list()).events)).toEqual(['Lublin', 'Zawody', 'Łódź Maraton', 'Śnieżka']);
    });

    it('rejects an order with events of another sport', async () => {
      const road = await createEvent('A');
      const trail = await createEvent('B', {}, 'trail_run');
      const res = await app.inject({
        method: 'PUT',
        url: '/api/events/order',
        headers: editor,
        payload: { sport: 'road_run', ids: [trail.id, road.id] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('saves the ordering mode per sport and sorts by Polish name', async () => {
      await createEvent('Zawody');
      await createEvent('Łódź Maraton');
      await createEvent('Lublin');
      await createActivity(race({ name: 'Śnieżka' }));

      const res = await app.inject({
        method: 'PUT',
        url: '/api/settings/events.ordering.road_run',
        headers: editor,
        payload: { value: 'name' },
      });
      expect(res.statusCode, res.body).toBe(200);
      const sorted = await list();
      expect(sorted.ordering).toBe('name');
      expect(names(sorted.events)).toEqual(['Lublin', 'Łódź Maraton', 'Śnieżka', 'Zawody']);
      expect((await list('trail_run')).ordering).toBe('manual');

      const read = await app.inject({
        url: '/api/settings/events.ordering.road_run',
        headers: viewer,
      });
      expect(read.json()).toEqual({ key: 'events.ordering.road_run', value: 'name' });
    });

    it('rejects unknown settings and values', async () => {
      const bad = [
        { url: '/api/settings/events.ordering.road_run', value: 'date', status: 400 },
        { url: '/api/settings/events.ordering.golf', value: 'name', status: 404 },
        { url: '/api/settings/other', value: 1, status: 404 },
      ];
      for (const { url, value, status } of bad) {
        const res = await app.inject({ method: 'PUT', url, headers: editor, payload: { value } });
        expect(res.statusCode, url).toBe(status);
      }
    });
  });

  describe('suggestions', () => {
    it('suggests events with a similar name in the same sport', async () => {
      const event = await createEvent('Bieg Niepodległości');
      await createEvent('Bieg Sylwestrowy');
      await createEvent('Bieg Niepodległości', {}, 'trail_run');
      const res = await app.inject({
        url: `/api/events/suggest?sport=road_run&name=${encodeURIComponent('XV Bieg Niepodleglosci 2025')}`,
        headers: viewer,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<EventSuggestion[]>()).toEqual([
        { id: event.id, name: 'Bieg Niepodległości', score: 1 },
      ]);
    });
  });
});

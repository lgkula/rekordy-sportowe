import { describe, expect, it } from 'vitest';
import { choiceOf, eventAssignment, NO_EVENT, pickerOptions } from './eventChoice';

const events = [
  { id: 1, name: 'Bieg Sylwestrowy' },
  { id: 2, name: 'Bieg Niepodległości' },
  { id: 3, name: 'Łódź Maraton' },
  { id: 4, name: 'Lublin Półmaraton' },
];

describe('eventAssignment', () => {
  it('maps each choice to the API fields', () => {
    expect(eventAssignment(NO_EVENT)).toEqual({ eventId: null });
    expect(eventAssignment({ kind: 'existing', id: 2, name: 'X' })).toEqual({ eventId: 2 });
    expect(eventAssignment({ kind: 'new', name: 'Nowy bieg' })).toEqual({
      eventId: null,
      newEventName: 'Nowy bieg',
    });
  });

  it('reads the choice of a saved activity', () => {
    expect(choiceOf(null, null)).toEqual(NO_EVENT);
    expect(choiceOf(3, 'Łódź Maraton')).toEqual({ kind: 'existing', id: 3, name: 'Łódź Maraton' });
  });
});

describe('pickerOptions', () => {
  it('lists suggestions first, then the other events by Polish name', () => {
    const options = pickerOptions(events, [{ id: 2, name: 'Bieg Niepodległości', score: 1 }], '');
    expect(options.suggested.map((e) => e.id)).toEqual([2]);
    expect(options.others.map((e) => e.name)).toEqual([
      'Bieg Sylwestrowy',
      'Lublin Półmaraton',
      'Łódź Maraton',
    ]);
    expect(options.createName).toBeNull();
  });

  it('ignores suggestions of events it does not know', () => {
    expect(pickerOptions(events, [{ id: 99, name: 'X', score: 1 }], '').suggested).toEqual([]);
  });

  it('filters by typed text without Polish letters and offers a new event', () => {
    const options = pickerOptions(events, [], 'lodz');
    expect(options.others.map((e) => e.id)).toEqual([3]);
    expect(options.createName).toBe('lodz');
  });

  it('matches similar names, too', () => {
    expect(pickerOptions(events, [], 'XV Bieg Niepodleglosci').others.map((e) => e.id)).toEqual([
      2,
    ]);
  });

  it('does not offer to create an event that exists', () => {
    expect(pickerOptions(events, [], ' łódź  maraton').createName).toBeNull();
  });
});

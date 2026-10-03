import {
  compareNamesPl,
  EVENT_SUGGESTION_MIN_SCORE,
  eventNameSimilarity,
  foldText,
  sameEventName,
  type EventSuggestion,
} from '@rekordy/core';

/**
 * The event chosen for a race in a form or the import review: none, an existing event, or a
 * new one created together with the activity (PLAN.md 4.3).
 */
export type EventChoice =
  { kind: 'none' } | { kind: 'existing'; id: number; name: string } | { kind: 'new'; name: string };

export const NO_EVENT: EventChoice = { kind: 'none' };

/** The event of a saved activity. */
export function choiceOf(eventId: number | null, eventName: string | null): EventChoice {
  return eventId === null ? NO_EVENT : { kind: 'existing', id: eventId, name: eventName ?? '' };
}

export function choiceName(choice: EventChoice): string {
  return choice.kind === 'none' ? '' : choice.name;
}

/** Assignment fields of the API (`eventId` / `newEventName`). */
export function eventAssignment(choice: EventChoice): {
  eventId: number | null;
  newEventName?: string;
} {
  switch (choice.kind) {
    case 'none':
      return { eventId: null };
    case 'existing':
      return { eventId: choice.id };
    case 'new':
      return { eventId: null, newEventName: choice.name };
  }
}

type NamedEvent = { id: number; name: string };

export type PickerOptions = {
  /** Events similar to the activity name (shown first while nothing is typed). */
  suggested: NamedEvent[];
  /** All events (nothing typed) or the ones matching the typed text, by name. */
  others: NamedEvent[];
  /** The typed name when no event has it: offered as "Utwórz nowe". */
  createName: string | null;
};

/**
 * Options of the event picker. With nothing typed: the suggestions for the activity name,
 * then every event. With a typed text: events whose name contains it (ignoring case and
 * Polish letters) or is similar to it, plus "create" unless an event has that name already.
 */
export function pickerOptions(
  events: readonly NamedEvent[],
  suggestions: readonly EventSuggestion[],
  search: string,
): PickerOptions {
  const byName = (a: NamedEvent, b: NamedEvent) => compareNamesPl(a.name, b.name);
  const text = search.trim();
  if (text === '') {
    const known = new Map(events.map((e) => [e.id, e]));
    const suggested = suggestions.flatMap((s) => {
      const event = known.get(s.id);
      return event ? [event] : [];
    });
    const ids = new Set(suggested.map((e) => e.id));
    return {
      suggested,
      others: events.filter((e) => !ids.has(e.id)).sort(byName),
      createName: null,
    };
  }
  const folded = foldText(text);
  const matches = events
    .filter(
      (e) =>
        foldText(e.name).includes(folded) ||
        eventNameSimilarity(text, e.name) >= EVENT_SUGGESTION_MIN_SCORE,
    )
    .sort(byName);
  return {
    suggested: [],
    others: matches,
    createName: events.some((e) => sameEventName(e.name, text)) ? null : text,
  };
}

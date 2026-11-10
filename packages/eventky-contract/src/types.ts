/** Versioned JSON stored in a normal Pubky post's string content. */
export type CalendarTime =
  | { type: 'date'; value: string }
  | { type: 'utc'; value: string }
  | { type: 'zoned'; value: string; tzid: string }
  | { type: 'floating'; value: string };

export type DateTimeValue = Exclude<CalendarTime, { type: 'date' }>;
export type RecurrencePeriod = { type: 'period'; start: DateTimeValue } & (
  | { end: DateTimeValue; duration?: never }
  | { duration: string; end?: never }
);

export type EventLocation = {
  id: string;
  kind: 'PHYSICAL' | 'VIRTUAL';
  label: string;
  uri?: string;
  description?: string;
  address?: string;
  geo?: { latitude: number; longitude: number };
};

export type StyledDescription = { format: 'markdown'; content: string };
export type EventStatus = 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED';
export type EventAlarm = { id: string; action: 'DISPLAY'; trigger: string; description: string };
export type Organizer = { name?: string; uri?: string; pubky_identity?: string };
export type SocialText = { version: 1; text: string };

/** Missing properties inherit; null explicitly clears an optional property. */
export type EventOccurrencePatch = {
  dtstart?: CalendarTime;
  dtend?: CalendarTime | null;
  duration?: string | null;
  summary?: string;
  description?: string | null;
  styled_description?: StyledDescription | null;
  status?: EventStatus;
  transp?: 'OPAQUE' | 'TRANSPARENT' | null;
  locations?: EventLocation[] | null;
  url?: string | null;
  alarms?: EventAlarm[] | null;
};

export type EventOverride = { recurrence_id: CalendarTime; changes: EventOccurrencePatch };

export type EventContent = {
  schema: 'eventky.event';
  schema_version: 1;
  uid: string;
  dtstamp: string;
  created: string;
  last_modified: string;
  sequence: number;
  summary: string;
  dtstart: CalendarTime;
  dtend?: CalendarTime;
  duration?: string;
  description?: string;
  styled_description?: StyledDescription;
  status?: EventStatus;
  transp?: 'OPAQUE' | 'TRANSPARENT';
  locations?: EventLocation[];
  image_uri?: string;
  url?: string;
  organizer?: Organizer;
  contact?: Organizer;
  rrule?: string;
  rdate?: (CalendarTime | RecurrencePeriod)[];
  exdate?: CalendarTime[];
  overrides?: EventOverride[];
  calendar_uris?: string[];
  categories?: string[];
  related_to?: { uid: string; relation: 'PARENT' | 'CHILD' | 'SIBLING'; uri?: string }[];
  alarms?: EventAlarm[];
  timezone_definitions?: Record<string, string>;
  extensions?: Record<string, unknown>;
  social?: SocialText;
};

export type CalendarContent = {
  schema: 'eventky.calendar';
  schema_version: 1;
  uid: string;
  name: string;
  description?: string;
  timezone: string;
  color?: string;
  image_uri?: string;
  url?: string;
  created: string;
  last_modified: string;
  sequence: number;
  contributors?: string[];
  excluded_event_uris?: string[];
  week_start?: 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
  default_event_duration?: string;
  extensions?: Record<string, unknown>;
  social?: SocialText;
};

export type ContractResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };
export type ParsedEventkyContent =
  | { status: 'supported'; kind: 'event'; value: EventContent }
  | { status: 'supported'; kind: 'calendar'; value: CalendarContent }
  | { status: 'unsupported-kind' | 'unsupported-version' }
  | { status: 'invalid'; issues: string[] };

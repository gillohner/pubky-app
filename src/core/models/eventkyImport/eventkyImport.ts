import Dexie, { type Table } from 'dexie';

export type EventkyImportRecord = {
  key: string;
  scope: string;
  source: string;
  uid: string;
  kind: 'event' | 'calendar';
  postId: string;
  payload: string;
  fingerprint: string;
  status: 'pending' | 'published';
  expectedContent?: string;
  attempted?: boolean;
  updatedAt: number;
};

/** Separate, durable import intents survive normal post-cache eviction and browser reloads. */
export class EventkyImportDatabase extends Dexie {
  records!: Table<EventkyImportRecord, string>;
  constructor(name = 'pubky-eventky-imports') {
    super(name);
    this.version(1).stores({ records: '&key, [scope+source]' });
  }
}

export const eventkyImportDb = new EventkyImportDatabase();

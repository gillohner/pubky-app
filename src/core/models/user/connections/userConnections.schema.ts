import type { Pubky } from '@/models/models.types';

export interface UserConnectionsModelSchema {
  id: Pubky;
  following: Pubky[];
  followers: Pubky[];
  /** Present only after the complete following directory was read from the homeserver. */
  followingSyncedAt?: number;
}

// Keep only the primary key index. Connection arrays are read/modified by id.
export const userConnectionsTableSchema = `
  &id
`;

export enum UserConnectionsFields {
  FOLLOWERS = 'followers',
  FOLLOWING = 'following',
}

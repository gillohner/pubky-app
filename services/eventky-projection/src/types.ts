export interface SourcePost {
  uri: string;
  kind: string;
  content: string;
}

export interface StoredSource extends SourcePost {
  hash: string;
  state: 'valid' | 'invalid' | 'unavailable';
  updated_at: string;
}

export interface ProjectionMetadata {
  backend_id: string;
  revision: number;
  scope: 'configured-nexus' | 'explicit-fixtures';
  reconciled_at: string | null;
  checked_at: string | null;
  checkpoint: string | null;
  source_ready: boolean;
}

/** Adapters expose current records; a DEL invalidation never supplies deletion authority by itself. */
export type HydratedSource =
  | { status: 'present'; post: SourcePost }
  | { status: 'deleted'; uri: string }
  | { status: 'unavailable'; uri: string };

export interface SourceInvalidation {
  uri: string;
  source?: HydratedSource;
}
export interface ChangeBatch {
  checkpoint: string;
  changes: SourceInvalidation[];
  reset?: boolean;
  caught_up: boolean;
}
export interface InventoryPage {
  posts: SourcePost[];
  next_cursor: string | null;
  checkpoint: string;
}

export interface SourceAdapter {
  backendId: string;
  inventory(cursor?: string): Promise<InventoryPage>;
  changes(checkpoint: string): Promise<ChangeBatch>;
  hydrate(uri: string): Promise<HydratedSource>;
  verifySnapshot?(start: string): Promise<void>;
}

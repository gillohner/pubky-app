import { HttpMethod } from '@/libs/http/http.types';
import type { PostSource } from '@/pipes/post/post.wire';

export interface TLocalSavePostParams {
  compositePostId: string;
  post: PostSource;
}

export interface TLocalUpdatePostStreamParams {
  compositePostId: string;
  kind: string;
  parentUri?: string | null;
  ops: Promise<unknown>[];
  action: HttpMethod.PUT | HttpMethod.DELETE;
}

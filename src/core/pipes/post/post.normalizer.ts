import { parse_uri, PubkyAppPost, PubkyAppPostEmbed, PubkyAppPostKind } from 'pubky-app-specs';
import { AppError } from '@/libs/error/error';
import { AuthErrorCode, ClientErrorCode, ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { isPostDeleted } from '@/libs/utils/utils';
import type { Pubky } from '@/models/models.types';
import { parseCompositeId } from '@/models/models.utils';
import type { CollectionContentInput } from '@/models/post/collection/collectionPost.types';
import { PubkySpecsSingleton } from '@/pipes/pipes.builder';
import type { PostValidatorData } from '@/pipes/pipes.types';
import { CollectionPostContent } from '@/pipes/post/post.collection';
import {
  builtinPostKind,
  normalizePostEmbed,
  postKindFromEnum,
  postKindFromSpecs,
  type PubkyPostWire,
  toPostWire,
  type UniversalPostResult,
  validatePostWire,
} from '@/pipes/post/post.wire';

export type TToEditParams = {
  compositePostId: string;
  content: string;
  currentUserPubky: Pubky;
  /** Resolved by the application before normalization; pipes never read storage. */
  source: PubkyPostWire | null;
  expectedContent?: string;
  /** Undefined preserves attachments; null or [] clears them. */
  attachments?: string[] | null;
  kind?: PubkyAppPostKind | string;
};

export class PostNormalizer {
  private constructor() {}

  /** Compatibility for actual specs getters; raw network kinds must pass through unchanged. */
  static postKindToLowerCase(kind: string): string {
    return postKindFromSpecs(kind);
  }

  static mapKindToEnum(kind: string): PubkyAppPostKind {
    const known = builtinPostKind(kind);
    if (known !== undefined) return known;
    throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Unsupported post kind', {
      service: ErrorService.Local,
      operation: 'mapKindToEnum',
      context: { kind },
    });
  }

  static createId(specsPubky: Pubky): string {
    return PubkySpecsSingleton.get(specsPubky).createPost('draft', PubkyAppPostKind.Short).meta.id;
  }

  static async toCollection(collection: CollectionContentInput, specsPubky: Pubky) {
    try {
      const normalized = CollectionPostContent.normalize(collection);
      return PubkySpecsSingleton.get(specsPubky).createCollectionPost(
        normalized.name,
        normalized.description,
        normalized.items,
        normalized.cover_image,
        normalized.layout,
      );
    } catch (error) {
      throw this.validationError(error, 'createCollectionPost');
    }
  }

  static async to(post: PostValidatorData, specsPubky: Pubky): Promise<UniversalPostResult> {
    const attachmentList = [
      ...(post.attachments ?? []).map((attachment) => attachment.fileResult.meta.url),
      ...(post.attachmentUris ?? []),
    ];
    return this.build(
      {
        kind: typeof post.kind === 'number' ? postKindFromEnum(post.kind) : post.kind,
        content: post.content,
        parent: post.parentUri ?? null,
        embed: post.embed ?? null,
        attachments: attachmentList.length > 0 ? attachmentList : null,
        lock: post.lock ?? null,
      },
      specsPubky,
      post.postId,
    );
  }

  static async toEdit({
    compositePostId,
    content,
    currentUserPubky,
    source,
    expectedContent,
    attachments,
    kind,
  }: TToEditParams): Promise<UniversalPostResult> {
    const { pubky: authorId, id: postId } = parseCompositeId(compositePostId);
    if (authorId !== currentUserPubky) {
      throw Err.auth(AuthErrorCode.FORBIDDEN, 'Current user is not the author of this post', {
        service: ErrorService.Local,
        operation: 'toEdit',
        context: { postId, currentUserPubky },
      });
    }
    if (!source || isPostDeleted(source.content)) {
      throw Err.client(ClientErrorCode.NOT_FOUND, 'Post not found', {
        service: ErrorService.Local,
        operation: 'toEdit',
        context: { postId: compositePostId },
      });
    }
    if (expectedContent !== undefined && source.content !== expectedContent) {
      throw Err.client(
        ClientErrorCode.CONFLICT,
        'This post changed since you opened the editor. Review the latest version before saving.',
        {
          service: ErrorService.Local,
          operation: 'toEdit',
          context: { postId: compositePostId },
        },
      );
    }
    return this.build(
      {
        ...source,
        content,
        kind: kind === undefined ? source.kind : typeof kind === 'number' ? postKindFromEnum(kind) : kind,
        attachments: attachments === undefined ? source.attachments : attachments?.length ? attachments : null,
      },
      authorId,
      postId,
    );
  }

  private static build(input: PubkyPostWire, authorId: Pubky, postId?: string): UniversalPostResult {
    try {
      const kind = builtinPostKind(input.kind);
      const embed = input.embed == null ? null : normalizePostEmbed(input.embed);
      if (input.parent) {
        const parsed = parse_uri(input.parent);
        if (parsed.resource !== 'posts') {
          throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Post parent must reference a Pubky post', {
            service: ErrorService.PubkyAppSpecs,
            operation: 'validatePostWire',
          });
        }
      }
      // The specs still validate built-in text and common fields. A placeholder
      // bypasses only opaque custom content and universal embed interpretation.
      const content = kind === undefined ? 'custom' : input.content;
      const validationEmbed =
        embed === null ? null : new PubkyAppPostEmbed('https://example.com/', PubkyAppPostKind.Link);
      const builder = PubkySpecsSingleton.get(authorId);
      const result =
        postId === undefined
          ? builder.createPost(
              content,
              kind ?? PubkyAppPostKind.Short,
              input.parent,
              validationEmbed,
              input.attachments,
              input.lock,
            )
          : builder.editPost(
              PubkyAppPost.new_with_lock(
                content,
                kind ?? PubkyAppPostKind.Short,
                input.parent,
                validationEmbed,
                input.attachments,
                input.lock,
              ),
              postId,
              content,
            );
      const sanitized = toPostWire(result.post);
      const post = validatePostWire({
        ...sanitized,
        kind: input.kind,
        content: kind === undefined ? input.content : sanitized.content,
        embed,
      });
      const meta = result.meta;
      return { post, meta: { id: meta.id, url: meta.url, path: meta.path } };
    } catch (error) {
      throw this.validationError(error, postId === undefined ? 'createPost' : 'editPost');
    }
  }

  private static validationError(error: unknown, operation: string): AppError {
    if (error instanceof AppError) return error;
    return Err.validation(ValidationErrorCode.INVALID_INPUT, error instanceof Error ? error.message : String(error), {
      service: ErrorService.PubkyAppSpecs,
      operation,
      cause: error,
    });
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileApplication } from '@/application/file/file';
import { PostApplication } from '@/application/post/post';
import type { TCreatePostInput, TEditPostInput, TPostUploadState } from '@/application/post/post.types';
import { TagApplication } from '@/application/tag/tag';
import { AuthErrorCode, ClientErrorCode, TimeoutErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { HttpMethod } from '@/libs/http/http.types';
import type { TFileAttachmentResult } from '@/pipes/file/file.types';
import { TEST_POST_IDS, TEST_PUBKY } from '@/pipes/pipes.test-utils';
import { toPostWire } from '@/pipes/post/post.wire';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { LocalPostService } from '@/services/local/post/post';

vi.mock('@/services/homeserver/homeserver', () => ({ HomeserverService: { request: vi.fn() } }));
vi.mock('@/services/local/post/post', () => ({
  LocalPostService: {
    create: vi.fn(),
    edit: vi.fn(),
    delete: vi.fn(),
    readDetails: vi.fn(),
    removeFromKindStreams: vi.fn(),
  },
}));
vi.mock('@/application/file/file', () => ({
  FileApplication: {
    commitCreate: vi.fn(),
    commitDelete: vi.fn(),
    commitDeleteUploaded: vi.fn(),
  },
}));
vi.mock('@/application/tag/tag', () => ({ TagApplication: { commitCreate: vi.fn() } }));

const author = TEST_PUBKY.USER_1;
const id = TEST_POST_IDS.POST_1;
const compositePostId = `${author}:${id}`;
const postUrl = `pubky://${author}/pub/pubky.app/posts/${id}`;
const attachment = `pubky://${author}/pub/pubky.app/files/new`;
const desired = toPostWire({
  kind: 'event',
  content: '{"name":"updated"}',
  attachments: [attachment],
  embed: 'geo:1,2',
  lock: `pubky://${author}/pub/lock`,
});
const previous = { ...desired, content: '{"name":"original"}' };
const files = [{ fileResult: { meta: { url: attachment } } }] as TFileAttachmentResult[];
const timeout = () =>
  Err.timeout(TimeoutErrorCode.REQUEST_TIMEOUT, 'PUT outcome unknown', {
    service: ErrorService.Homeserver,
    operation: 'PUT',
  });
const rejected = () =>
  Err.auth(AuthErrorCode.UNAUTHORIZED, 'Access rejected', { service: ErrorService.Homeserver, operation: 'PUT' });
const state = (): TPostUploadState => ({ completed: false });
const createInput = (): TCreatePostInput => ({
  compositePostId,
  postUrl,
  post: desired,
  fileAttachments: files,
  uploadState: state(),
});
const editInput = (): TEditPostInput => ({
  ...createInput(),
  expectedContent: previous.content,
  expectedSource: previous,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(FileApplication.commitCreate).mockResolvedValue(undefined);
  vi.mocked(FileApplication.commitDelete).mockResolvedValue(undefined);
  vi.mocked(FileApplication.commitDeleteUploaded).mockResolvedValue(undefined);
  vi.mocked(LocalPostService.create).mockResolvedValue(undefined);
  vi.mocked(LocalPostService.edit).mockResolvedValue(undefined);
  vi.mocked(LocalPostService.readDetails).mockResolvedValue({
    ...previous,
    id: compositePostId,
    uri: postUrl,
    indexed_at: 1,
    attachments: previous.attachments ?? null,
  });
});

describe('native publication retry contract', () => {
  it('hydrates legacy source embeds and preserves exact custom kind strings', async () => {
    vi.mocked(HomeserverService.request).mockResolvedValue({
      kind: 'Image',
      content: 'opaque',
      embed: { kind: 'link', uri: 'geo:1,2' },
    });
    await expect(PostApplication.getEditSource({ compositeId: compositePostId })).resolves.toEqual({
      kind: 'Image',
      content: 'opaque',
      parent: null,
      embed: 'geo:1,2',
      attachments: null,
      lock: null,
    });
  });

  it('maps only an actual source HTTP 404 to absence', async () => {
    const notFound = Err.client(ClientErrorCode.NOT_FOUND, 'Missing', {
      service: ErrorService.Homeserver,
      operation: 'GET',
      context: { statusCode: 404 },
    });
    vi.mocked(HomeserverService.request).mockRejectedValue(notFound);
    await expect(PostApplication.getEditSource({ compositeId: compositePostId })).resolves.toBeNull();
    const noStatus = Err.client(ClientErrorCode.NOT_FOUND, 'Other missing dependency', {
      service: ErrorService.Homeserver,
      operation: 'GET',
    });
    vi.mocked(HomeserverService.request).mockRejectedValue(noStatus);
    await expect(PostApplication.getEditSource({ compositeId: compositePostId })).rejects.toBe(noStatus);
  });

  it('publishes a raw envelope with its exact custom kind and opaque content', async () => {
    const input = createInput();
    input.post = { ...desired, kind: 'Image', content: '  ' + 'x'.repeat(5000) + '  ' };
    vi.mocked(HomeserverService.request).mockResolvedValue(undefined);
    await expect(PostApplication.commitCreate(input)).resolves.toEqual({ tagsFailed: false });
    expect(HomeserverService.request).toHaveBeenCalledWith({
      method: HttpMethod.PUT,
      url: postUrl,
      bodyJson: input.post,
    });
  });

  it('confirms a timed-out create by complete source read-back without deleting referenced files', async () => {
    const input = createInput();
    vi.mocked(HomeserverService.request).mockRejectedValueOnce(timeout()).mockResolvedValueOnce(desired);
    await expect(PostApplication.commitCreate(input)).resolves.toEqual({ tagsFailed: false });
    expect(input.uploadState).toEqual({ completed: true, postUncertain: false });
    expect(LocalPostService.delete).not.toHaveBeenCalled();
    expect(FileApplication.commitDeleteUploaded).not.toHaveBeenCalled();
  });

  it('reuses uploaded files after an unresolved create timeout', async () => {
    const input = createInput();
    const failure = timeout();
    vi.mocked(HomeserverService.request)
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    await expect(PostApplication.commitCreate(input)).rejects.toBe(failure);
    expect(input.uploadState).toEqual({ completed: true, postUncertain: true });
    await PostApplication.commitCreate(input);
    expect(FileApplication.commitCreate).toHaveBeenCalledTimes(1);
    expect(FileApplication.commitDeleteUploaded).not.toHaveBeenCalled();
    expect(LocalPostService.delete).not.toHaveBeenCalled();
    const writes = vi
      .mocked(HomeserverService.request)
      .mock.calls.filter(([request]) => request.method === HttpMethod.PUT);
    expect(writes).toHaveLength(2);
    expect(writes[0][0]).toEqual(writes[1][0]);
  });

  it('preserves files after a later definitive rejection when an earlier create is unresolved', async () => {
    const input = createInput();
    const failure = timeout();
    vi.mocked(HomeserverService.request).mockRejectedValue(failure);
    await expect(PostApplication.commitCreate(input)).rejects.toBe(failure);
    const denied = rejected();
    vi.mocked(HomeserverService.request).mockRejectedValue(denied);
    await expect(PostApplication.commitCreate(input)).rejects.toBe(denied);
    expect(input.uploadState?.postUncertain).toBe(true);
    expect(FileApplication.commitDeleteUploaded).not.toHaveBeenCalled();
    expect(LocalPostService.delete).not.toHaveBeenCalled();
  });

  it('rolls back a first definitive rejection and resets uploads for a deliberate retry', async () => {
    const input = createInput();
    const denied = rejected();
    vi.mocked(HomeserverService.request).mockRejectedValue(denied);
    await expect(PostApplication.commitCreate(input)).rejects.toBe(denied);
    expect(input.uploadState?.completed).toBe(false);
    expect(LocalPostService.delete).toHaveBeenCalledWith({ compositePostId });
    expect(FileApplication.commitDeleteUploaded).toHaveBeenCalledWith(files);
    expect(TagApplication.commitCreate).not.toHaveBeenCalled();
  });

  it('rejects an edit conflict before uploads, local writes, or PUT', async () => {
    const input = editInput();
    vi.mocked(HomeserverService.request).mockResolvedValue({ ...previous, content: 'changed by another editor' });
    await expect(PostApplication.commitEdit(input)).rejects.toMatchObject({ code: ClientErrorCode.CONFLICT });
    expect(FileApplication.commitCreate).not.toHaveBeenCalled();
    expect(LocalPostService.edit).not.toHaveBeenCalled();
    expect(
      vi.mocked(HomeserverService.request).mock.calls.every(([request]) => request.method === HttpMethod.GET),
    ).toBe(true);
  });

  it.each([
    [
      'attachments',
      { ...previous, attachments: [attachment, `pubky://${author}/pub/pubky.app/files/added-elsewhere`] },
    ],
    ['lock', { ...previous, lock: null }],
    ['parent', { ...previous, parent: `pubky://${author}/pub/pubky.app/posts/another` }],
    ['embed', { ...previous, embed: 'geo:3,4' }],
    ['kind', { ...previous, kind: 'calendar' }],
  ] as const)('rejects a newer %s field even when source content is unchanged', async (_field, changedSource) => {
    const input = editInput();
    vi.mocked(HomeserverService.request).mockResolvedValue(changedSource);
    await expect(PostApplication.commitEdit(input)).rejects.toMatchObject({ code: ClientErrorCode.CONFLICT });
    expect(FileApplication.commitCreate).not.toHaveBeenCalled();
    expect(FileApplication.commitDelete).not.toHaveBeenCalled();
    expect(LocalPostService.edit).not.toHaveBeenCalled();
    expect(
      vi.mocked(HomeserverService.request).mock.calls.every(([request]) => request.method === HttpMethod.GET),
    ).toBe(true);
  });

  it('checks the prepared envelope even without a legacy content guard', async () => {
    const input = editInput();
    input.expectedContent = undefined;
    vi.mocked(HomeserverService.request).mockResolvedValue({ ...previous, attachments: null });
    await expect(PostApplication.commitEdit(input)).rejects.toMatchObject({ code: ClientErrorCode.CONFLICT });
    expect(LocalPostService.edit).not.toHaveBeenCalled();
    expect(FileApplication.commitCreate).not.toHaveBeenCalled();
  });

  it('retains the legacy content guard for callers without a prepared envelope', async () => {
    const input = editInput();
    input.expectedSource = undefined;
    vi.mocked(HomeserverService.request).mockResolvedValue({ ...previous, content: 'newer content' });
    await expect(PostApplication.commitEdit(input)).rejects.toMatchObject({ code: ClientErrorCode.CONFLICT });
    expect(LocalPostService.edit).not.toHaveBeenCalled();
  });

  it('compares normalized envelope fields without treating absent nulls as another revision', async () => {
    const input = editInput();
    const { parent: _parent, ...withoutParent } = previous;
    input.expectedSource = withoutParent;
    vi.mocked(HomeserverService.request).mockResolvedValueOnce(previous).mockResolvedValueOnce(undefined);
    await expect(PostApplication.commitEdit(input)).resolves.toBeUndefined();
    expect(HomeserverService.request).toHaveBeenCalledWith({ method: HttpMethod.PUT, url: postUrl, bodyJson: desired });
  });

  it('reconciles a successful earlier edit on retry without another upload or PUT', async () => {
    const input = editInput();
    const failure = timeout();
    vi.mocked(HomeserverService.request)
      .mockResolvedValueOnce(previous)
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(desired);
    await expect(PostApplication.commitEdit(input)).rejects.toBe(failure);
    await expect(PostApplication.commitEdit(input)).resolves.toBeUndefined();
    expect(FileApplication.commitCreate).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(HomeserverService.request).mock.calls.filter(([request]) => request.method === HttpMethod.PUT),
    ).toHaveLength(1);
    expect(FileApplication.commitDeleteUploaded).not.toHaveBeenCalled();
    expect(input.uploadState?.postUncertain).toBe(false);
  });

  it('does not accept matching edit content when the source attachments differ', async () => {
    const input = editInput();
    vi.mocked(HomeserverService.request).mockResolvedValue({ ...desired, attachments: null });
    await expect(PostApplication.commitEdit(input)).rejects.toMatchObject({ code: ClientErrorCode.CONFLICT });
    expect(FileApplication.commitCreate).not.toHaveBeenCalled();
  });

  it('keeps already-published edit files if local convergence fails', async () => {
    const input = editInput();
    vi.mocked(HomeserverService.request).mockResolvedValue(desired);
    vi.mocked(LocalPostService.edit).mockRejectedValue(new Error('local quota'));
    await expect(PostApplication.commitEdit(input)).rejects.toThrow('local quota');
    expect(FileApplication.commitDeleteUploaded).not.toHaveBeenCalled();
  });
});

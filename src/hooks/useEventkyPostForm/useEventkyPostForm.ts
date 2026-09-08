'use client';

import { useRef, useState } from 'react';
import { isCalendarMember, parseEventkyContent } from '@eventky/contract';
import type { CalendarContent, ContractResult, EventContent } from '@eventky/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { PostController } from '@/controllers/post/post';
import type { TPreparedPostCreate, TPreparedPostEdit } from '@/controllers/post/post.types';
import { useEventkyAttachments } from '@/hooks/useEventkyAttachments/useEventkyAttachments';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory } from '@/libs/error/error.types';
import { isAppError } from '@/libs/error/error.utils';
import { getEventkyEnabled } from '@/libs/runtime-config/runtime-config';
import { toast } from '@/molecules/Toaster/toast';
import { useAuthStore } from '@/stores/auth/auth.store';
import { type EventkyPostFormData, eventkyPostFormSchema, type EventkyPostKind } from './useEventkyPostForm.types';
import { buildEventkyFormContent, getEventkyFormDefaults } from './useEventkyPostForm.utils';

export interface EventkyPostFormOptions {
  kind: EventkyPostKind;
  source?: EventContent | CalendarContent;
  originalContent?: string;
  postId?: string;
  attachmentUris?: string[];
  initialDescription?: string;
  initialTags?: string[];
  initialFiles?: File[];
}

/** Keeps the identity and payload stable after an uncertain publish so retry addresses the same post. */
export function useEventkyPostForm(input: EventkyPostFormOptions) {
  const [options] = useState(input);
  const authorId = useAuthStore((state) => state.currentUserPubky);
  const [defaults] = useState(() => getEventkyFormDefaults(options.kind, options.source, options.initialDescription));
  const form = useForm<EventkyPostFormData>({
    resolver: zodResolver(eventkyPostFormSchema),
    defaultValues: defaults,
    mode: 'onChange',
  });
  const files = useEventkyAttachments({
    postId: options.postId,
    uris: options.attachmentUris,
    initialFiles: options.initialFiles,
  });
  const [tags, setTags] = useState(options.initialTags ?? []);
  const [pendingRetry, setPendingRetry] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const prepared = useRef<
    { kind: 'create'; value: TPreparedPostCreate } | { kind: 'edit'; value: TPreparedPostEdit } | null
  >(null);
  const inFlight = useRef(false);
  const draftAuthor = useRef<string | null>(null);
  const allocatedId = useRef<string | null>(null);
  const draft = useRef<{ postId: string; content: string } | null>(null);

  const previewEvent = (): ContractResult<EventContent> => {
    const serialized = buildEventkyFormContent(
      options.kind,
      form.getValues(),
      {
        uid: options.source?.uid ?? 'preview@eventky.pubky',
        now: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      },
      options.source,
      defaults,
    );
    if (!serialized.ok) return serialized;
    const parsed = parseEventkyContent('event', serialized.value);
    return parsed.status === 'supported' && parsed.kind === 'event'
      ? { ok: true, value: parsed.value }
      : { ok: false, issues: ['Complete the event fields before previewing its schedule.'] };
  };

  const submit = async (): Promise<string | null> => {
    if (!authorId || !files.ready || hasConflict || inFlight.current) return null;
    const ensureCurrentAuthor = () => {
      if (useAuthStore.getState().currentUserPubky === authorId) return true;
      if (prepared.current) setPendingRetry(true);
      else draft.current = null;
      form.setError('root', {
        message: 'Your account changed. Switch back to the original account to retry this draft.',
      });
      return false;
    };
    if (!ensureCurrentAuthor()) return null;
    if (draftAuthor.current && draftAuthor.current !== authorId) {
      form.setError('root', {
        message: 'This draft belongs to a different account. Reopen the editor for the current account.',
      });
      return null;
    }
    if (!getEventkyEnabled()) {
      form.setError('root', { message: 'Event publishing is not enabled on this instance.' });
      return null;
    }
    let result: string | null = null;
    inFlight.current = true;
    draftAuthor.current = authorId;
    try {
      await form.handleSubmit(async (data) => {
        if (!ensureCurrentAuthor()) return;
        form.clearErrors('root');
        try {
          if (!draft.current) {
            const postId = allocatedId.current ?? options.postId ?? PostController.createPostId(authorId);
            allocatedId.current = postId;
            const serialized = buildEventkyFormContent(
              options.kind,
              data,
              {
                uid: options.source?.uid ?? `${crypto.randomUUID()}@eventky.pubky`,
                now: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
              },
              options.source,
              defaults,
            );
            if (!serialized.ok) {
              form.setError('root', { message: serialized.issues.join(' ') });
              return;
            }
            draft.current = { postId, content: serialized.value };
          }
          if (!prepared.current && options.kind === 'event') {
            const event = parseEventkyContent('event', draft.current.content);
            if (event.status !== 'supported' || event.kind !== 'event') return;
            const eventUri = options.postId
              ? `pubky://${options.postId.replace(':', '/pub/pubky.app/posts/')}`
              : `pubky://${authorId}/pub/pubky.app/posts/${draft.current.postId}`;
            for (const uri of event.value.calendar_uris ?? []) {
              const source = await PostController.fetchSource({
                compositeId: `${uri.split('/')[2]}:${uri.split('/').at(-1)}`,
              });
              if (!ensureCurrentAuthor()) return;
              const calendar = source ? parseEventkyContent(source.kind, source.content) : null;
              if (
                !calendar ||
                calendar.status !== 'supported' ||
                calendar.kind !== 'calendar' ||
                !isCalendarMember(uri, calendar.value, eventUri, event.value)
              ) {
                form.setError('root', {
                  message:
                    'Choose calendars you own or contribute to. Remove unavailable or excluded calendars before publishing.',
                });
                draft.current = null;
                return;
              }
            }
          }
          if (options.postId) {
            if (!prepared.current)
              prepared.current = {
                kind: 'edit',
                value: await PostController.prepareEdit({
                  compositePostId: options.postId,
                  content: draft.current.content,
                  expectedContent: options.originalContent,
                  attachments: files.editChanges,
                }),
              };
            if (!ensureCurrentAuthor()) return;
            if (prepared.current.kind !== 'edit') return;
            await PostController.commitPreparedEdit(prepared.current.value);
            if (!ensureCurrentAuthor()) return;
            result = options.postId;
          } else {
            if (!prepared.current)
              prepared.current = {
                kind: 'create',
                value: await PostController.prepareCreate({
                  authorId,
                  customKind: options.kind,
                  postId: draft.current.postId,
                  content: draft.current.content,
                  tags,
                  attachments: files.attachments,
                }),
              };
            if (!ensureCurrentAuthor()) return;
            if (prepared.current.kind !== 'create') return;
            const created = await PostController.commitPreparedCreate(prepared.current.value);
            if (!ensureCurrentAuthor()) return;
            result = created.compositePostId;
            if (created.tagsFailed)
              toast({
                variant: 'error',
                description: 'Your post was published. Some tags could not be added; add them from the post.',
              });
          }
          setPendingRetry(false);
          toast({
            title: options.postId
              ? 'Changes saved'
              : options.kind === 'event'
                ? 'Event published'
                : 'Calendar published',
          });
        } catch (e) {
          if (!ensureCurrentAuthor()) return;
          const conflict = isAppError(e) && e.code === ClientErrorCode.CONFLICT;
          const rejected =
            isAppError(e) &&
            e.category !== undefined &&
            [ErrorCategory.Validation, ErrorCategory.Client, ErrorCategory.Auth, ErrorCategory.RateLimit].includes(
              e.category,
            );
          const uncertain =
            prepared.current !== null &&
            (pendingRetry || prepared.current.value.uploadState?.postUncertain === true || !rejected);
          setPendingRetry(uncertain);
          setHasConflict(conflict && !uncertain);
          if (!uncertain) {
            prepared.current = null;
            draft.current = null;
          }
          form.setError('root', {
            message:
              conflict && !uncertain
                ? 'This post changed while you were editing. Keep a copy of your changes, then reopen the editor to load the latest version.'
                : uncertain
                  ? 'The save could not be confirmed. Your draft is retained. Retry to check and save the same post.'
                  : 'The save was rejected. Check the fields and your connection, then try again.',
          });
        }
      })();
    } finally {
      inFlight.current = false;
    }
    return result;
  };
  return {
    form,
    files,
    tags,
    setTags,
    submit,
    previewEvent,
    pendingRetry,
    hasConflict,
    isEditing: !!options.postId,
    dirty: form.formState.isDirty || files.changed || tags.length > 0,
  };
}

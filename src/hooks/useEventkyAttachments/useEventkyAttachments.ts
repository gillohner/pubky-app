'use client';

import { useRef, useState } from 'react';
import { IMAGE_MAX_RAW_SIZE } from '@/config/images';
import {
  ATTACHMENT_MAX_OTHER_SIZE,
  POST_ATTACHMENT_MAX_FILES,
  POST_SUPPORTED_ATTACHMENT_MIME_TYPES,
} from '@/config/posts';
import { useEditAttachments } from '@/hooks/useEditAttachments/useEditAttachments';
import type { ExistingAttachment } from '@/hooks/usePost/usePost.types';
import { toast } from '@/molecules/Toaster/toast';

export function useEventkyAttachments({
  postId,
  uris,
  initialFiles = [],
}: {
  postId?: string;
  uris?: string[];
  initialFiles?: File[];
}) {
  const [attachments, setAttachments] = useState<File[]>(initialFiles);
  const [existingAttachments, setExistingAttachments] = useState<ExistingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openPicker = () => fileInputRef.current?.click();
  const { seededUris } = useEditAttachments({
    enabled: !!postId,
    postId,
    uris,
    existingAttachments,
    setExistingAttachments,
  });
  const handleFilesAdded = (files: File[]) => {
    const room = Math.max(0, POST_ATTACHMENT_MAX_FILES - attachments.length - existingAttachments.length);
    const accepted = files
      .filter(
        (file) =>
          POST_SUPPORTED_ATTACHMENT_MIME_TYPES.includes(file.type) &&
          file.size <= (file.type.startsWith('image/') ? IMAGE_MAX_RAW_SIZE : ATTACHMENT_MAX_OTHER_SIZE),
      )
      .slice(0, room);
    if (accepted.length !== files.length)
      toast({
        variant: 'error',
        description: 'Some attachments exceed the supported file type, size, or count limits.',
      });
    setAttachments((previous) => [...previous, ...accepted]);
  };
  const removeExisting = (uri: string) =>
    setExistingAttachments((previous) => previous.filter((file) => file.uri !== uri));
  const kept = existingAttachments.map((file) => file.uri);
  const changed =
    attachments.length > 0 || (seededUris !== undefined && JSON.stringify(kept) !== JSON.stringify(seededUris));
  return {
    attachments,
    setAttachments,
    existingAttachments,
    fileInputRef,
    openPicker,
    handleFilesAdded,
    removeExisting,
    changed,
    ready: !postId || seededUris !== undefined,
    editChanges: changed && seededUris ? { original: seededUris, kept, added: attachments } : undefined,
  };
}

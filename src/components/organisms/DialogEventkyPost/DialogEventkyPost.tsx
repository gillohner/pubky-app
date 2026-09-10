'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/atoms/Dialog/Dialog';
import { useConfirmableDialog } from '@/hooks/useConfirmableDialog/useConfirmableDialog';
import { type EventkyPostFormOptions, useEventkyPostForm } from '@/hooks/useEventkyPostForm/useEventkyPostForm';
import { DialogConfirmDiscard } from '@/molecules/DialogConfirmDiscard/DialogConfirmDiscard';
import { EventkyPostForm } from '@/organisms/EventkyPostForm/EventkyPostForm';

type Props = EventkyPostFormOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (postId: string) => void;
};

/** Mount only while open: a closed composer releases its draft and resets RHF/attachment snapshots. */
export function DialogEventkyPost({ open, onOpenChange, onSuccess, ...options }: Props) {
  const state = useEventkyPostForm(options);
  const confirmation = useConfirmableDialog({
    onClose: () => onOpenChange(false),
    hasContent: () => state.dirty || state.pendingRetry,
  });
  const title = `${state.isEditing ? 'Edit' : 'New'} ${options.kind === 'event' ? 'event' : 'calendar'}`;
  const submit = async () => {
    const postId = await state.submit();
    if (postId) {
      onSuccess?.(postId);
      onOpenChange(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!state.form.formState.isSubmitting) confirmation.handleOpenChange(next);
      }}
    >
      <DialogContent avoidKeyboard className="w-4xl" hiddenTitle={title}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title} with native post interactions</DialogDescription>
        </DialogHeader>
        <EventkyPostForm
          state={state}
          kind={options.kind}
          onSubmit={() => {
            void submit();
          }}
        />
        <DialogConfirmDiscard
          open={confirmation.showConfirmDialog}
          onOpenChange={() => confirmation.setShowConfirmDialog(false)}
          onConfirm={confirmation.handleDiscard}
        />
      </DialogContent>
    </Dialog>
  );
}

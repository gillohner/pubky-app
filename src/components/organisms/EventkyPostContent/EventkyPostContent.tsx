'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { parseEventkyContent } from '@eventky/contract';
import { CalendarDays, Clock, Globe, MapPin, Repeat, UserRound } from 'lucide-react';
import { getCalendarRoute, POST_ROUTES } from '@/app/routes';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Typography } from '@/atoms/Typography/Typography';
import { useDeviceTimezone } from '@/hooks/useDeviceTimezone/useDeviceTimezone';
import { useLinkConfirmation } from '@/hooks/useLinkConfirmation/useLinkConfirmation';
import { formatEventRecurrence, formatEventSchedule } from '@/libs/eventky/display';
import { UNSUPPORTED_POST_FORMAT } from '@/libs/post/postPreview';
import { getEventkyCalendarEnabled } from '@/libs/runtime-config/runtime-config';
import { getSafeExternalUrl } from '@/libs/utils/safeExternalUrl';
import { cn } from '@/libs/utils/utils';
import { parseCompositeId } from '@/models/models.utils';
import { PostText } from '@/molecules/PostText/PostText';
import { PostUnavailable } from '@/molecules/PostUnavailable/PostUnavailable';
import { DialogCheckLink } from '@/organisms/DialogCheckLink/DialogCheckLink';
import { EventkyAttendance } from '@/organisms/EventkyAttendance/EventkyAttendance';
import { PostAttachments } from '@/organisms/PostAttachments/PostAttachments';
import type { PostAttachmentsProps } from '@/organisms/PostAttachments/PostAttachments.types';
import { useEventkyOccurrence } from './EventkyOccurrenceContext';

interface EventkyPostContentProps extends PostAttachmentsProps {
  postId: string;
  kind: string;
  content: string;
  className?: string;
}

/** Structured body only: moderation, authors, tags and actions remain in the shared post shell. */
export function EventkyPostContent({
  postId,
  kind,
  content,
  attachments,
  localAttachments,
  mediaVariant = 'default',
  className,
}: EventkyPostContentProps) {
  const { dialogOpen, setDialogOpen, clickedLink, handleLinkClick } = useLinkConfirmation();
  const deviceTimezone = useDeviceTimezone();
  const onPostPage = usePathname().startsWith(POST_ROUTES.POST);
  const source = parseEventkyContent(kind, content);
  const occurrence = useEventkyOccurrence();
  const parsed =
    source.status === 'supported' &&
    source.kind === 'event' &&
    occurrence?.projection.post_id === postId &&
    occurrence.sourceContent === content
      ? { ...source, value: occurrence.event }
      : source;
  if (parsed.status !== 'supported') return <PostUnavailable message={UNSUPPORTED_POST_FORMAT} />;

  const { pubky, id } = parseCompositeId(postId);
  const postUri = `pubky://${pubky}/pub/pubky.app/posts/${id}`;
  const externalLink = (url: string, label: string) => {
    const safeUrl = getSafeExternalUrl(url);
    return safeUrl ? (
      <a
        href={safeUrl}
        onClick={(event) => handleLinkClick(safeUrl, event)}
        className="text-brand underline underline-offset-4"
      >
        {label}
      </a>
    ) : (
      <span>{label}</span>
    );
  };

  return (
    <Container className={cn('min-w-0 gap-3', className)} data-testid="eventky-post-content">
      <Container overrideDefaults className="flex min-w-0 items-start gap-2">
        <CalendarDays aria-hidden="true" className="mt-1 size-5 shrink-0 text-muted-foreground" />
        <Typography as="h2" size="lg" className="min-w-0 text-xl wrap-anywhere">
          {parsed.kind === 'event' ? parsed.value.summary : parsed.value.name}
        </Typography>
        {parsed.kind === 'calendar' && parsed.value.color && (
          <span
            aria-hidden="true"
            className="mt-2 size-3 shrink-0 rounded-full"
            style={{ backgroundColor: parsed.value.color }}
          />
        )}
      </Container>

      {parsed.kind === 'event' ? (
        <>
          <Container overrideDefaults className="flex flex-wrap items-center gap-2">
            <Badge variant={parsed.value.status === 'CANCELLED' ? 'destructive' : 'secondary'}>
              {parsed.value.status === 'CANCELLED'
                ? 'Cancelled'
                : parsed.value.status === 'TENTATIVE'
                  ? 'Tentative'
                  : 'Event'}
            </Badge>
            {parsed.value.transp === 'TRANSPARENT' && <Badge variant="outline">Free time</Badge>}
          </Container>
          <Typography size="sm" className="flex items-start gap-2 text-muted-foreground">
            <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{formatEventSchedule(parsed.value, deviceTimezone)}</span>
          </Typography>
          {formatEventRecurrence(parsed.value) && (
            <Typography size="sm" className="flex items-center gap-2 text-muted-foreground">
              <Repeat aria-hidden="true" className="size-4 shrink-0" />
              {formatEventRecurrence(parsed.value)}
            </Typography>
          )}
          {parsed.value.locations?.map((location) => (
            <Container key={location.id} className="gap-1">
              <Typography size="sm" className="flex items-start gap-2 wrap-anywhere">
                {location.kind === 'VIRTUAL' ? (
                  <Globe aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                )}
                <span>
                  {location.kind === 'VIRTUAL' && 'Online · '}
                  {location.uri ? externalLink(location.uri, location.label) : location.label}
                </span>
              </Typography>
              {location.address && (
                <Typography size="sm" className="pl-6 wrap-anywhere text-muted-foreground">
                  {location.address}
                </Typography>
              )}
            </Container>
          ))}
          {parsed.value.organizer?.name && (
            <Typography size="sm" className="flex items-start gap-2 text-muted-foreground">
              <UserRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              Organizer: {parsed.value.organizer.name}
            </Typography>
          )}
          {(parsed.value.styled_description?.content || parsed.value.description) && (
            <PostText
              content={parsed.value.styled_description?.content || parsed.value.description || ''}
              isArticle
              fullArticle={onPostPage}
              onLinkClick={handleLinkClick}
              className={cn('text-muted-foreground', !onPostPage && 'line-clamp-4')}
            />
          )}
          {parsed.value.url && <Typography size="sm">{externalLink(parsed.value.url, 'Event website')}</Typography>}
        </>
      ) : (
        <>
          <Typography size="sm" className="text-muted-foreground">
            Calendar
          </Typography>
          {parsed.value.description && <PostText content={parsed.value.description} onLinkClick={handleLinkClick} />}
          {getEventkyCalendarEnabled() && (
            <Button asChild variant="outline" size="sm" className="w-fit">
              <Link href={getCalendarRoute([postUri])} onClick={(event) => event.stopPropagation()}>
                Upcoming events
              </Link>
            </Button>
          )}
          {parsed.value.url && <Typography size="sm">{externalLink(parsed.value.url, 'Calendar website')}</Typography>}
        </>
      )}
      {parsed.kind === 'event' && (
        <EventkyAttendance
          key={`${postId}:${occurrence?.projection.occurrence_key ?? 'series'}`}
          postId={postId}
          eventUid={parsed.value.uid}
          recurrenceId={
            occurrence?.projection.post_id === postId &&
            source.status === 'supported' &&
            source.kind === 'event' &&
            (source.value.rrule || source.value.rdate?.length)
              ? occurrence.projection.recurrence_id
              : undefined
          }
          cancelled={parsed.value.status === 'CANCELLED'}
        />
      )}
      <PostAttachments attachments={attachments} localAttachments={localAttachments} mediaVariant={mediaVariant} />
      <DialogCheckLink open={dialogOpen} onOpenChangeAction={setDialogOpen} linkUrl={clickedLink} />
    </Container>
  );
}

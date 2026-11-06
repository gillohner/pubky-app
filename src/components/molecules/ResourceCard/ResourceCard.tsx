'use client';

import { useId, useState } from 'react';
import {
  CalendarDays,
  CircleAlert,
  CircleOff,
  Clock,
  CloudOff,
  Globe,
  type LucideProps,
  MapPin,
  Users,
} from 'lucide-react';
import { getResourceRoute } from '@/app/routes';
import { Audio } from '@/atoms/Audio/Audio';
import { Badge } from '@/atoms/Badge/Badge';
import { Button, ButtonVariant } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { useOgMetadata } from '@/hooks/useOgMetadata/useOgMetadata';
import { cn } from '@/libs/utils/utils';
import { useIsPostPreviewNavigable } from '@/molecules/PostPreviewCard/PostPreviewNestingContext';
import { PinakesCreditField, PinakesStatus, type TPinakesCredit } from '@/services/pinakes/pinakes.types';
import { type ResourceCardProps, ResourceFamily } from './ResourceCard.types';
import {
  formatResourceDates,
  formatResourcePoint,
  getDisplayLink,
  getEventStatusNote,
  getHttpUrl,
  getResourceFamily,
  getResourceLinks,
  getResourceStatus,
  getResourceTypeLabel,
  hasWideImage,
} from './ResourceCard.utils';
import { CARD_MUTED_TEXT, ResourceCardFrame, ResourceCardHeader } from './ResourceCardFrame';
import { ResourceCardMedia } from './ResourceCardMedia';
import { ResourceCredits, type TResourceBorrowedNote } from './ResourceCredits';
import { getShownCredits } from './ResourceCredits.utils';
import { ResourceFactList } from './ResourceFactList';
import { getResourceDetailRows, getResourceSummary } from './ResourceFacts.utils';
import { getResourceTypeIcon } from './ResourceTypeIcon';
import { useResourceFallback } from './useResourceFallback';

/** What a card that is not `ok` says about itself. Only `missing` has a documented meaning (`/llms.txt`). */
const STATUS_NOTES: Readonly<
  Record<Exclude<PinakesStatus, PinakesStatus.OK>, { text: string; icon: React.ComponentType<LucideProps> }>
> = {
  [PinakesStatus.PENDING]: { text: 'Details are still being read', icon: Clock },
  [PinakesStatus.MISSING]: { text: 'No longer available at the source', icon: CircleOff },
  [PinakesStatus.UNREACHABLE]: { text: 'The source could not be reached', icon: CloudOff },
  [PinakesStatus.ERROR]: { text: 'Details could not be read', icon: CircleAlert },
};

/** How an event is attended, when not only in person (`attendance`). */
const ATTENDANCE_LABELS: Readonly<Record<string, string>> = {
  online: 'Online',
  mixed: 'Online and in person',
};

/** A large card's description longer than this is clamped on a phone, with "More". */
const LONG_DESCRIPTION_CHARS = 280;

const DETAIL_ICON_SIZE = 14;

/**
 * One card for every external resource Pinakes knows, whatever its type, shown the way the app
 * shows an embedded post: inside the post's frame, the type in plain words on the left and the
 * source (site icon and name, never the full link) on the right, then the image (or the type's
 * icon), the title, one summary line of the facts that matter for the type (`getResourceSummary`:
 * a song's artist, length and album; a place's address; a job's employer, location and date), and
 * the description. An event leads with its dates, venue, organizer and whether it is online. A
 * podcast episode plays its audio (`stream`).
 *
 * A sparse card borrows a description or an image from another member of its group, with an
 * "Image: <site>" note (`useResourceFallback`). A Wikimedia Commons file shows with its credit
 * when Pinakes sends one, and without it otherwise. The card never shows less than the link's own
 * preview: a title or image it still lacks comes from the link's OpenGraph data, as the plain
 * preview shows it.
 *
 * The whole card is a click-through to the link, unless its actions' ⋯ menu lists other services
 * (`hasAlsoOn`: the same thing on other services too, `also_on`), where the viewer picks the
 * service, or its object is gone (`missing`); the source is its link either way, except for a
 * `missing` card, whose link is dead.
 * A card with a service's player (`renderBody`) is no click-through either.
 *
 * A text or image Pinakes enriched the card with comes with its credit (`credits`): the `large`
 * card lists them under "Sources", the default card in one line (author, source and licence); both
 * close the card's body, above its actions.
 *
 * The title opens the resource's page (`/resource?uri=<card.uri>`) and the source links out. Where
 * links may not navigate (the composer, a post quoted in a dialog) the title links out instead. The
 * `large` card heads that page: its title is a heading and no link (the header's "Open in <site>" is
 * the one way out), its description is clamped only on a phone (with "More"), every fact is listed
 * under "Details", and it is no click-through.
 *
 * Only `http(s)` values become external links, images or audio; every text field is rendered as text.
 */
export function ResourceCard({
  card,
  href,
  actions,
  hasAlsoOn = false,
  size = 'default',
  renderBody,
}: ResourceCardProps) {
  const navigable = useIsPostPreviewNavigable();
  const [expanded, setExpanded] = useState(false);
  const [failedImages, setFailedImages] = useState<string[]>([]);

  const status = getResourceStatus(card.status);
  const isMissing = status === PinakesStatus.MISSING;
  const family = getResourceFamily(card);
  const isEvent = family === ResourceFamily.EVENT;
  const typeLabel = getResourceTypeLabel(card);
  const { linkUrl, sourceUri, siteName } = getResourceLinks(card, href);
  const isLarge = size === 'large';
  // A `missing` card's own link is gone upstream: neither the card, its heading nor its source
  // send the viewer there.
  const titleUrl = isMissing ? null : linkUrl;
  // With other services to pick from, the viewer picks one in the actions' ⋯ menu (or the header's
  // link). The large card heads the resource's own page: its header's "Open in <site>" links out,
  // the card itself does not; nor does a card whose body may turn into a player (`renderBody`).
  const clickThroughUrl = hasAlsoOn || isLarge || renderBody ? null : titleUrl;
  // The title always opens the resource's page, as on the page itself; where links may not navigate
  // (the composer, a quoted post in a dialog) in a new tab, so the draft or dialog stays.
  const smallTitleUrl = getResourceRoute(card.uri);
  const titleTarget = navigable ? undefined : '_blank';
  const descriptionId = useId();

  const imageUrl = getHttpUrl(card.image);
  const description = card.description?.trim() || null;
  // An own image that failed to load leaves the slot to a group member's, like no image at all.
  const ownImageShown = imageUrl !== null && !failedImages.includes(imageUrl);
  const fallback = useResourceFallback(card, {
    description: !description,
    image: !ownImageShown,
    skipImages: failedImages,
  });
  const cardImage = ownImageShown ? imageUrl : (fallback.image?.value ?? null);
  const usableCardImage = cardImage && !failedImages.includes(cardImage) ? cardImage : null;
  // The least a card shows is what the link's own preview shows (its OpenGraph title and image, the
  // same `/api/og-metadata` read): a title or image the card still lacks comes from there. A gone
  // link (`missing`) is not asked.
  // Asked once the group has answered, so a group image is never first replaced by the OG one.
  const needsOg = titleUrl !== null && !fallback.pending && (!card.name?.trim() || usableCardImage === null);
  const { metadata: og } = useOgMetadata(needsOg ? titleUrl : null);
  const ogImage = getHttpUrl(og?.image);
  const shownImage = usableCardImage ?? (ogImage && !failedImages.includes(ogImage) ? ogImage : null);
  const title = card.name?.trim() || og?.title?.trim() || getDisplayLink(href || card.uri);
  const shownDescription = description ?? fallback.description?.value ?? null;

  const summary = getResourceSummary(card);
  const dates = isEvent ? formatResourceDates(card) : null;
  const venue = isEvent ? card.venue?.name?.trim() || null : null;
  const organizer = isEvent ? getOrganizer(card, venue) : null;
  const attendance = isEvent ? (ATTENDANCE_LABELS[card.attendance?.trim().toLowerCase() ?? ''] ?? null) : null;
  // Coordinates only for a place or event that has nothing better to say where it is.
  const point =
    family !== ResourceFamily.WEB && !venue && !summary && card.point ? formatResourcePoint(card.point) : null;
  const eventStatusNote = isEvent ? getEventStatusNote(card.event_status) : null;
  const statusNote = status === PinakesStatus.OK ? null : STATUS_NOTES[status];
  const streamUrl = card.stream && card.stream.type?.startsWith('audio/') ? getHttpUrl(card.stream.url) : null;

  const credits = [
    ...getShownCredits(card, { imageShown: ownImageShown }),
    ...[fallback.description?.credit, usableCardImage && !ownImageShown ? fallback.image?.credit : null].filter(
      (credit): credit is TPinakesCredit => credit != null,
    ),
  ];
  const borrowedNotes: (TResourceBorrowedNote | null)[] = [
    fallback.description && !description && !fallback.description.credit
      ? { field: PinakesCreditField.DESCRIPTION, site: fallback.description.site, href: fallback.description.href }
      : null,
    fallback.image && !ownImageShown && usableCardImage && !fallback.image.credit
      ? { field: PinakesCreditField.IMAGE, site: fallback.image.site, href: fallback.image.href }
      : null,
  ];
  const borrowed = borrowedNotes.filter((note): note is TResourceBorrowedNote => note !== null);
  const detailRows = isLarge ? getResourceDetailRows(card, { withDates: !isEvent }) : [];
  const isLongDescription = isLarge && (shownDescription?.length ?? 0) > LONG_DESCRIPTION_CHARS;
  const clampOnPhone = isLongDescription && !expanded;

  const eventDetails = (dates || venue || organizer || attendance) && (
    <>
      {dates && <ResourceDetail icon={CalendarDays} text={dates} testId="resource-card-dates" />}
      {venue && <ResourceDetail icon={MapPin} text={venue} testId="resource-card-venue" />}
      {organizer && (
        <ResourceDetail icon={Users} testId="resource-card-organizer">
          by{' '}
          {organizer.href ? (
            <Link href={organizer.href} overrideDefaults className="hover:text-brand hover:underline">
              {organizer.name}
            </Link>
          ) : (
            organizer.name
          )}
        </ResourceDetail>
      )}
      {attendance && (
        <Badge variant="secondary" data-testid="resource-card-attendance">
          <Globe aria-hidden="true" />
          {attendance}
        </Badge>
      )}
    </>
  );

  return (
    <ResourceCardFrame
      clickThroughUrl={clickThroughUrl}
      // The large card stands where a post stands on its page, on the post card's surface.
      className={cn(CARD_MUTED_TEXT, isLarge && 'divide-border bg-card text-card-foreground shadow-sm')}
      data-testid="resource-card"
      data-status={status}
      data-family={family}
      data-size={size}
    >
      <Container
        overrideDefaults
        className={cn('flex min-w-0 flex-col gap-3', isLarge ? 'p-6' : 'p-4', clickThroughUrl && 'cursor-pointer')}
      >
        <ResourceCardHeader
          typeLabel={typeLabel}
          sourceUri={sourceUri}
          href={titleUrl}
          siteName={siteName}
          openIn={isLarge}
        />

        {(renderBody ?? keepBody)(
          <Container overrideDefaults className="flex min-w-0 gap-4">
            <ResourceCardMedia
              imageUrl={shownImage}
              typeIcon={getResourceTypeIcon(card)}
              wideByType={hasWideImage(card)}
              isLarge={isLarge}
              dimmed={isMissing}
              onImageError={(url) => setFailedImages((urls) => [...urls, url])}
            />

            <Container className="min-w-0 flex-1 gap-1.5">
              {statusNote && (
                <Badge variant="secondary" data-testid="resource-card-status" className="max-w-full whitespace-normal">
                  <statusNote.icon aria-hidden="true" />
                  {statusNote.text}
                </Badge>
              )}
              {isLarge ? (
                <Typography
                  as="h2"
                  overrideDefaults
                  dir="auto"
                  className={cn(
                    'text-xl font-bold wrap-anywhere text-foreground sm:text-2xl',
                    isMissing && 'text-foreground/70',
                  )}
                >
                  {/* Not a link: the header's "Open in <site>" is the one way to the same place. */}
                  <span data-testid="resource-card-title">{title}</span>
                </Typography>
              ) : (
                <Link
                  href={smallTitleUrl}
                  target={titleTarget}
                  rel={titleTarget ? 'noopener noreferrer' : undefined}
                  overrideDefaults
                  dir="auto"
                  title={title}
                  data-testid="resource-card-title"
                  className="line-clamp-3 text-base font-bold wrap-anywhere text-foreground hover:text-brand"
                >
                  {title}
                </Link>
              )}

              {summary && (
                <Typography
                  size="sm"
                  dir="auto"
                  data-testid="resource-card-summary"
                  title={summary}
                  className="line-clamp-2 font-medium wrap-anywhere text-foreground/90"
                >
                  {summary}
                </Typography>
              )}

              {/* An event leads with when and where. */}
              {eventDetails}

              {shownDescription && (
                <Typography
                  size="sm"
                  dir="auto"
                  id={descriptionId}
                  data-testid="resource-card-description"
                  data-borrowed={description ? undefined : 'true'}
                  className={cn(
                    'font-normal wrap-anywhere text-muted-foreground',
                    !isLarge && 'line-clamp-2',
                    clampOnPhone && 'max-sm:line-clamp-6',
                  )}
                >
                  {shownDescription}
                </Typography>
              )}
              {isLongDescription && (
                <Button
                  type="button"
                  variant={ButtonVariant.GHOST}
                  data-testid="resource-card-more"
                  aria-expanded={expanded}
                  aria-controls={descriptionId}
                  onClick={() => setExpanded((value) => !value)}
                  className="h-auto w-fit p-0 text-sm font-medium text-foreground hover:bg-transparent hover:text-brand sm:hidden"
                >
                  {expanded ? 'Less' : 'More'}
                </Button>
              )}

              {point && <ResourceDetail icon={MapPin} text={point} testId="resource-card-point" />}
              {eventStatusNote && (
                <ResourceDetail icon={CircleAlert} text={eventStatusNote} testId="resource-card-event-status" />
              )}
              {card.attribution && (
                <Typography
                  size="xs"
                  data-testid="resource-card-attribution"
                  className="font-normal wrap-anywhere text-muted-foreground"
                >
                  {card.attribution}
                </Typography>
              )}
            </Container>
          </Container>,
        )}

        {streamUrl && (
          <Container overrideDefaults data-resource-controls className="flex flex-col gap-1">
            <Audio src={streamUrl} preload="none" data-testid="resource-card-audio" aria-label={`Play ${title}`} />
            {card.stream?.preview && (
              <Typography size="xs" className="font-normal text-muted-foreground">
                Preview
              </Typography>
            )}
          </Container>
        )}

        {isLarge && <ResourceFactList rows={detailRows} />}

        <ResourceCredits credits={credits} borrowed={borrowed} variant={isLarge ? 'full' : 'compact'} />
      </Container>

      {actions}
    </ResourceCardFrame>
  );
}

/**
 * Who runs an event, linked when `http(s)`. Left out when it only repeats the venue or the
 * performer (a concert page names the artist as its organizer).
 */
function getOrganizer(
  card: ResourceCardProps['card'],
  venue: string | null,
): { name: string; href: string | null } | null {
  const name = card.organizer?.name?.trim();
  if (!name) return null;
  const performer = card.facts?.performer?.trim().toLowerCase();
  if (name.toLowerCase() === performer || name.toLowerCase() === venue?.toLowerCase()) return null;
  return { name, href: getHttpUrl(card.organizer?.url) };
}

function ResourceDetail({
  icon: Icon,
  text,
  testId,
  children,
}: {
  icon: React.ComponentType<LucideProps>;
  text?: string;
  testId: string;
  children?: React.ReactNode;
}) {
  return (
    <Container data-testid={testId} className="flex-row items-start gap-1.5 text-muted-foreground">
      <Icon size={DETAIL_ICON_SIZE} aria-hidden="true" className="mt-0.5 shrink-0" />
      <Typography as="span" size="sm" dir="auto" className="font-normal wrap-anywhere text-muted-foreground">
        {children ?? text}
      </Typography>
    </Container>
  );
}

function keepBody(body: React.ReactNode): React.ReactNode {
  return body;
}

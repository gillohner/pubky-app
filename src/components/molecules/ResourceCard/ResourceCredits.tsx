import { Fragment, useId } from 'react';
import { Container } from '@/atoms/Container/Container';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { PinakesCreditField, type TPinakesCredit } from '@/services/pinakes/pinakes.types';
import { getHttpUrl } from './ResourceCard.utils';
import {
  CREDIT_FIELD_LABELS,
  getCreditProviderName,
  getCreditSubjectLabel,
  getLicenseLabel,
} from './ResourceCredits.utils';

/** In a line of text a link is underlined; in the compact line every name is one. */
const FULL_LINK_CLASS_NAME = 'underline underline-offset-2 hover:text-brand';
const COMPACT_LINK_CLASS_NAME = 'hover:text-brand hover:underline';

interface ResourceCreditsProps {
  /**
   * The credits of the values the card shows (`getShownCredits`); renders nothing when empty. A
   * credit for a field without a label (not `PinakesCreditField`) is left out here too.
   */
  credits: TPinakesCredit[];
  /**
   * `full`: a "Sources" list, one line per credit with its license (the resource page).
   * `compact`: one line of source names, each linked, truncated to the card's width (a card in a
   * post); the licenses are in the links' accessible names and titles.
   */
  variant: 'full' | 'compact';
}

/**
 * Where a card's enriched text and image come from (Wikipedia, Wikimedia Commons, ...) and under
 * which license. Only `http(s)` URLs become links; every other value is text.
 */
export function ResourceCredits({ credits, variant }: ResourceCreditsProps) {
  const labelled = credits.filter((credit) => Object.hasOwn(CREDIT_FIELD_LABELS, credit.field));
  if (labelled.length === 0) return null;
  return variant === 'full' ? (
    <ResourceCreditsFull credits={labelled} />
  ) : (
    <ResourceCreditsCompact credits={labelled} />
  );
}

function ResourceCreditsFull({ credits }: { credits: TPinakesCredit[] }) {
  const headingId = useId();
  return (
    <Container
      as="section"
      aria-labelledby={headingId}
      data-testid="resource-credits"
      data-variant="full"
      className="gap-1"
    >
      <Typography as="h2" id={headingId} size="xs" className="text-muted-foreground">
        Sources
      </Typography>
      <ul className="flex flex-col gap-1">
        {credits.map((credit, index) => (
          <li
            key={`${credit.field}:${credit.source_url}:${index}`}
            data-testid="resource-credit"
            data-field={credit.field}
            className="text-xs font-normal wrap-anywhere text-muted-foreground"
          >
            <CreditLine credit={credit} />
          </li>
        ))}
      </ul>
    </Container>
  );
}

/**
 * `Text: Wikipedia (en), excerpt · CC BY-SA 4.0` or `Image: <author> · Wikimedia Commons · CC BY-SA 4.0`:
 * a text is named by its source, an image by its author. The source links to its page, the license
 * to its text.
 */
function CreditLine({ credit }: { credit: TPinakesCredit }) {
  const isText = credit.field === PinakesCreditField.DESCRIPTION;
  const subjectUrl = getHttpUrl(credit.subject);
  const subjectLabel = getCreditSubjectLabel(credit.subject);
  const qualifiers = [credit.excerpted && 'excerpt', credit.modified && 'modified'].filter(Boolean).join(', ');
  const license = getLicenseLabel(credit.license);
  const licenseUrl = getHttpUrl(credit.license_url);

  return (
    <>
      {CREDIT_FIELD_LABELS[credit.field]}: {!isText && credit.author && <>{credit.author} · </>}
      <MaybeLink href={getHttpUrl(credit.source_url)} testId="resource-credit-source" className={FULL_LINK_CLASS_NAME}>
        {getCreditProviderName(credit)}
      </MaybeLink>
      {credit.lang && <> ({credit.lang})</>}
      {qualifiers && <>, {qualifiers}</>}
      {subjectUrl && subjectLabel && (
        <>
          , about{' '}
          <MaybeLink href={subjectUrl} testId="resource-credit-subject" className={FULL_LINK_CLASS_NAME}>
            {subjectLabel}
          </MaybeLink>
        </>
      )}
      {license && (
        <>
          {' · '}
          <MaybeLink href={licenseUrl} testId="resource-credit-license" className={FULL_LINK_CLASS_NAME}>
            {license}
          </MaybeLink>
        </>
      )}
    </>
  );
}

/** One source per name and page: a text and an image from one page are one link. */
function ResourceCreditsCompact({ credits }: { credits: TPinakesCredit[] }) {
  const sources = new Map<string, { name: string; href: string | null; notes: string[] }>();
  for (const credit of credits) {
    const name = getCreditProviderName(credit);
    const key = `${name}\n${credit.source_url}`;
    const source = sources.get(key) ?? { name, href: getHttpUrl(credit.source_url), notes: [] };
    const license = getLicenseLabel(credit.license);
    const field = CREDIT_FIELD_LABELS[credit.field].toLowerCase();
    source.notes.push(license ? `${field}, ${license}` : field);
    sources.set(key, source);
  }

  return (
    <Typography
      size="xs"
      data-testid="resource-credits"
      data-variant="compact"
      className="truncate font-normal text-muted-foreground"
    >
      <span className="sr-only">Sources: </span>
      {[...sources.values()].map((source, index) => (
        <Fragment key={`${source.name}:${index}`}>
          {index > 0 && ' · '}
          <MaybeLink
            href={source.href}
            notes={source.notes.join('; ')}
            testId="resource-credit-source"
            className={COMPACT_LINK_CLASS_NAME}
          >
            {source.name}
          </MaybeLink>
        </Fragment>
      ))}
    </Typography>
  );
}

/** A link out when `href` is `http(s)` (new tab), else the same text. */
function MaybeLink({
  href,
  notes,
  testId,
  className,
  children,
}: {
  href: string | null;
  /** Said in brackets after the visible text, in the accessible name and the title. */
  notes?: string;
  testId: string;
  className: string;
  children: string;
}) {
  const label = notes ? `${children} (${notes})` : undefined;
  if (!href) {
    // Not a link, so no accessible name: the notes are read as text, `title` alone is not.
    return (
      <span data-testid={testId} title={label}>
        {children}
        {notes && <span className="sr-only"> ({notes})</span>}
      </span>
    );
  }
  return (
    <Link href={href} overrideDefaults aria-label={label} title={label} data-testid={testId} className={className}>
      {children}
    </Link>
  );
}

'use client';

import { getResourceRoute } from '@/app/routes';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import {
  getAlsoOnEditionNote,
  getLanguageName,
  getLanguageTag,
  type TAlsoOnEdition,
} from '@/molecules/ResourceCard/ResourceAlsoOn.utils';
import { ResourceListRow } from '@/molecules/ResourceCard/ResourceListRow';
import { useAlsoOnEdition } from '@/molecules/ResourceCard/useAlsoOnEdition';
import { getAlsoOnSource } from './ResourceAlsoOnList.utils';

interface ResourceAlsoOnLanguagesRowProps {
  /** The service's name without a language (`Wikipedia`). */
  name: string;
  /** Its editions, two or more, in the order Also on lists them. */
  editions: TAlsoOnEdition[];
  testId: string;
}

/**
 * One service in several languages on the resource page: a row (`Wikipedia`, the language in its
 * note) opening the Pubky page of the edition in the viewer's language (else English, else the first), and beside
 * it a compact select (the app's `Select`) of the languages, each named in its own language
 * (`Deutsch (de)`). Choosing one changes where the row links; it does not open anything. The
 * select's name says what it switches and what is chosen ("Wikipedia language: Deutsch (de)").
 */
export function ResourceAlsoOnLanguagesRow({ name, editions, testId }: ResourceAlsoOnLanguagesRowProps) {
  const { edition, setLang } = useAlsoOnEdition(editions);

  return (
    <ResourceListRow
      uri={edition.entry.uri}
      // The chosen edition's page on Pubky, as every Also on row opens.
      href={getResourceRoute(edition.entry.uri)}
      name={name}
      note={getAlsoOnEditionNote(edition, { withSource: false })}
      source={getAlsoOnSource(edition.entry)}
      testId={testId}
      trailing={
        <Select value={edition.lang} onValueChange={setLang}>
          <SelectTrigger
            size="sm"
            aria-label={`${name} language: ${getLanguageName(edition.lang)}`}
            data-testid={`${testId}-language`}
            className="max-w-32 min-w-0 shrink-0 gap-1 px-2 text-xs font-normal text-muted-foreground hover:text-foreground focus-visible:text-foreground"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end" className="max-h-72">
            {editions.map(({ lang }) => (
              <SelectItem key={lang} value={lang} className="text-sm">
                <span lang={getLanguageTag(lang)}>{getLanguageName(lang)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

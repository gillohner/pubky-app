'use client';

import { useState, useSyncExternalStore } from 'react';
import { pickAlsoOnLanguage, type TAlsoOnEdition } from './ResourceAlsoOn.utils';

function subscribe(onChange: () => void) {
  window.addEventListener('languagechange', onChange);
  return () => window.removeEventListener('languagechange', onChange);
}

/** The viewer's languages as one string, a stable snapshot (`navigator.languages` is a new array). */
function getLanguages(): string {
  return (navigator.languages?.length ? navigator.languages : [navigator.language]).filter(Boolean).join(',');
}

/**
 * None on the server. Not reached today (the menu mounts on the client only, and the resource page
 * reads Pinakes in the browser, so its list mounts after hydration); it keeps a list rendered on
 * the server on English, else the first edition, until it hydrates, without a mismatch. Language
 * names (`Intl.DisplayNames`) can differ between Node and the browser, so such a list would need
 * the same care for them.
 */
function getServerLanguages(): string {
  return '';
}

/**
 * The edition a row of editions shows and links to: the one the viewer picked, else the one
 * `pickAlsoOnLanguage` chooses for the browser's languages. Picking only changes the row's link.
 * The pick lives as long as the row: a menu row starts again from the default each time the menu
 * opens, as does each card in a feed.
 */
export function useAlsoOnEdition(editions: TAlsoOnEdition[]) {
  const languages = useSyncExternalStore(subscribe, getLanguages, getServerLanguages);
  const [picked, setPicked] = useState<string | null>(null);
  const lang =
    picked !== null && editions.some((edition) => edition.lang === picked)
      ? picked
      : pickAlsoOnLanguage(
          editions.map((edition) => edition.lang),
          languages ? languages.split(',') : [],
        );
  const edition = editions.find((candidate) => candidate.lang === lang) ?? editions[0];
  return { edition, setLang: setPicked };
}

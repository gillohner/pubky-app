import type { EmbedData, EmbedProvider } from './Providers/Provider.types';

export type PostLinkEmbedsProps = {
  content: string;
  /** The content is a post being written (the composer's preview), not a published post. */
  isComposing?: boolean;
};

export type ParseUrlForLinkEmbedResult = {
  embed: EmbedData | null;
  provider: EmbedProvider | null;
};

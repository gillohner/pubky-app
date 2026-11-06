interface PostInputLinkEmbedBaseProps {
  /** Whether the button is disabled (while the post is being published). */
  disabled?: boolean;
}

export interface PostInputLinkEmbedEmbeddedProps extends PostInputLinkEmbedBaseProps {
  /** The web link the post will embed. */
  url: string;
  isRemoved?: false;
  /** Removes the embed; the link stays in the text. */
  onRemove: () => void;
  /**
   * Where `url` is among the text's links that can be embedded, while there are several: the line
   * then shows "1 / 3" with ‹ › to embed another one. Null or left out for a single link.
   */
  choice?: { index: number; count: number } | null;
  /** Embeds the previous link of the text. */
  onPrevious?: () => void;
  /** Embeds the next link of the text. */
  onNext?: () => void;
}

export interface PostInputLinkEmbedRemovedProps extends PostInputLinkEmbedBaseProps {
  /** The author removed the embed: only a line saying so, with the button that embeds the link again. */
  isRemoved: true;
  /** Embeds the removed link again. */
  onRestore: () => void;
}

export type PostInputLinkEmbedProps = PostInputLinkEmbedEmbeddedProps | PostInputLinkEmbedRemovedProps;

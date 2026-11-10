/** Canonicalize legacy Nexus embed objects without filling absent envelope fields. */
export function normalizeLegacyPostDetailsEmbed<T extends { embed?: string | null }>(details: T): T {
  const embed: unknown = details.embed;
  if (embed && typeof embed === 'object' && 'uri' in embed && typeof embed.uri === 'string') {
    return { ...details, embed: embed.uri };
  }
  return details;
}

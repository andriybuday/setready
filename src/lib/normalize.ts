/**
 * Normalize an artist or song name into a stable cache key for track
 * matching. Two spellings that differ only in case, punctuation, accents,
 * or a leading "The" must hit the same cached match.
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Slug for a shareable show page, e.g. "metallica-2026-06-01". */
export function showSlug(headliner: string, eventDate: string): string {
  return `${normalizeName(headliner).replace(/\s+/g, "-")}-${eventDate}`;
}

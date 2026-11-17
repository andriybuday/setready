import { normalizeName } from "./normalize";

/**
 * Operator's followed artists. These are the highest discovery priority
 * because Ticketmaster genre labels classify many heavy acts only as
 * Rock/Alternative and miss personal non-metal favourites entirely.
 */
export const FOLLOWED_ARTISTS = [
  "Architects",
  "Ashnikko",
  "Bad Omens",
  "Bleed From Within",
  "Breaking Benjamin",
  "Bullet for My Valentine",
  "Bury Tomorrow",
  "Currents",
  "Dark Tranquillity",
  "Dethklok",
  "Escape the Fate",
  "Falling In Reverse",
  "Fozzy",
  "Gojira",
  "Gorillaz",
  "Guano Apes",
  "Heaven Shall Burn",
  "Hollywood Undead",
  "In Flames",
  "Jinjer",
  "Lacrimosa",
  "Lacuna Coil",
  "LANDMVRKS",
  "Linkin Park",
  "Mr. Kitty",
  "NOTHING MORE",
  "Orbit Culture",
  "Parkway Drive",
  "Skillet",
  "Soulfly",
  "Spiritbox",
  "Static-X",
] as const;

const FOLLOWED = new Set(FOLLOWED_ARTISTS.map(normalizeName));

export function isFollowedArtist(artist: string): boolean {
  return FOLLOWED.has(normalizeName(artist));
}

export function hasFollowedArtist(artists: Iterable<string>): boolean {
  return [...artists].some(isFollowedArtist);
}

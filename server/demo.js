// Demo catalogue: real-world cultural names, but every affinity score, fee and
// provenance link here is synthetic. The UI shows a permanent DEMO banner
// whenever these functions serve a request.

const ARTISTS = [
  { id: 'demo-artist-arijit', name: 'Arijit Singh', tags: ['bollywood', 'romantic', 'playback'], feeLakh: 34, blurb: 'Playback heavyweight; pulls a singalong crowd.' },
  { id: 'demo-artist-diljit', name: 'Diljit Dosanjh', tags: ['punjabi', 'pop', 'bollywood'], feeLakh: 38, blurb: 'Punjabi pop, festival-scale energy.' },
  { id: 'demo-artist-prateek', name: 'Prateek Kuhad', tags: ['indie', 'acoustic', 'romantic'], feeLakh: 9, blurb: 'Soft indie set, strong campus recall.' },
  { id: 'demo-artist-anuv', name: 'Anuv Jain', tags: ['indie', 'acoustic'], feeLakh: 7, blurb: 'Acoustic indie with a young, singalong audience.' },
  { id: 'demo-artist-ritviz', name: 'Ritviz', tags: ['electronic', 'indie', 'pop'], feeLakh: 12, blurb: 'Electronic hooks built for open-air stages.' },
  { id: 'demo-artist-nucleya', name: 'Nucleya', tags: ['electronic', 'bass'], feeLakh: 14, blurb: 'Bass-heavy closer for late-night crowds.' },
  { id: 'demo-artist-localtrain', name: 'The Local Train', tags: ['rock', 'hindi'], feeLakh: 8, blurb: 'Hindi rock with a proven college circuit.' },
  { id: 'demo-artist-wcmt', name: 'When Chai Met Toast', tags: ['indie', 'pop'], feeLakh: 5.5, blurb: 'Bright indie-pop, easy afternoon fit.' },
  { id: 'demo-artist-seedhemaut', name: 'Seedhe Maut', tags: ['hiphop', 'rap'], feeLakh: 6.5, blurb: 'Hindi hip-hop, high student pull.' },
  { id: 'demo-artist-divine', name: 'Divine', tags: ['hiphop', 'rap'], feeLakh: 11, blurb: 'Mainstream rap with strong youth reach.' },
  { id: 'demo-artist-shreya', name: 'Shreya Ghoshal', tags: ['bollywood', 'playback', 'romantic'], feeLakh: 28, blurb: 'Playback voice with a family audience.' },
  { id: 'demo-artist-raghav', name: 'Raghav Meattle', tags: ['indie', 'pop'], feeLakh: 2.5, blurb: 'Emerging indie-pop, budget-friendly.' },
  { id: 'demo-artist-hanita', name: 'Hanita Bhambri', tags: ['indie', 'acoustic'], feeLakh: 2.2, blurb: 'Intimate acoustic songwriting.' },
  { id: 'demo-artist-kamakshi', name: 'Kamakshi Khanna', tags: ['indie', 'pop'], feeLakh: 2, blurb: 'Warm indie-pop, growing campus base.' },
  { id: 'demo-artist-twin', name: 'Twin Strings', tags: ['indie', 'acoustic', 'romantic'], feeLakh: 1.8, blurb: 'Duo covers and originals; low cost, high warmth.' },
  { id: 'demo-artist-papon', name: 'Papon', tags: ['folk', 'bollywood'], feeLakh: 10, blurb: 'Folk-rooted set with regional resonance.' },
  { id: 'demo-artist-amit', name: 'Amit Trivedi', tags: ['bollywood', 'indie'], feeLakh: 20, blurb: 'Composer-performer with a deep catalogue.' },
  { id: 'demo-artist-lisa', name: 'Lisa Mishra', tags: ['pop', 'indie'], feeLakh: 4, blurb: 'Contemporary pop voice, strong streaming presence.' },
  { id: 'demo-artist-sanam', name: 'Sanam', tags: ['retro', 'pop'], feeLakh: 7, blurb: 'Retro covers band; multi-generation appeal.' },
  { id: 'demo-artist-farhan', name: 'Farhan Akhtar', tags: ['rock', 'bollywood'], feeLakh: 16, blurb: 'Rock-led live act with mass recognition.' },
];

const MOVIES = [
  { id: 'demo-movie-interstellar', name: 'Interstellar', tags: ['scifi', 'cinematic'], feeLakh: 1.2, blurb: 'Sci-fi spectacle that rewards a big screen.' },
  { id: 'demo-movie-inception', name: 'Inception', tags: ['scifi', 'thriller'], feeLakh: 1.0, blurb: 'Puzzle thriller with repeat-watch value.' },
  { id: 'demo-movie-3idiots', name: '3 Idiots', tags: ['comedy', 'campus'], feeLakh: 0.8, blurb: 'Campus classic, guaranteed laughs.' },
  { id: 'demo-movie-znmd', name: 'Zindagi Na Milegi Dobara', tags: ['drama', 'travel'], feeLakh: 0.9, blurb: 'Feel-good travel drama.' },
  { id: 'demo-movie-andhadhun', name: 'Andhadhun', tags: ['thriller', 'comedy'], feeLakh: 0.7, blurb: 'Dark-comic thriller that holds a crowd.' },
  { id: 'demo-movie-lalaland', name: 'La La Land', tags: ['musical', 'romantic'], feeLakh: 1.1, blurb: 'Musical romance, strong late-night fit.' },
  { id: 'demo-movie-whiplash', name: 'Whiplash', tags: ['music', 'drama'], feeLakh: 0.8, blurb: 'Music drama for the film-club crowd.' },
  { id: 'demo-movie-tumbbad', name: 'Tumbbad', tags: ['horror', 'folklore'], feeLakh: 0.6, blurb: 'Indian folk horror, cult following.' },
  { id: 'demo-movie-queen', name: 'Queen', tags: ['drama', 'travel'], feeLakh: 0.7, blurb: 'Coming-of-age favourite.' },
  { id: 'demo-movie-eeaao', name: 'Everything Everywhere All at Once', tags: ['scifi', 'comedy'], feeLakh: 1.3, blurb: 'Genre-bending, meme-literate crowd pull.' },
  { id: 'demo-movie-barfi', name: 'Barfi', tags: ['romantic', 'drama'], feeLakh: 0.6, blurb: 'Gentle romance with wide recall.' },
  { id: 'demo-movie-dangal', name: 'Dangal', tags: ['sports', 'drama'], feeLakh: 0.9, blurb: 'Sports drama, family-friendly.' },
];

const PLACES = [
  { id: 'demo-place-chai', name: 'Chai Sutta Bar', tags: ['chai', 'snacks'], feeLakh: 0.35, blurb: 'Queue-friendly chai counter.' },
  { id: 'demo-place-brijwasi', name: 'Brijwasi Sweets', tags: ['indian', 'sweets'], feeLakh: 0.45, blurb: 'Local sweets and chaat.' },
  { id: 'demo-place-mocha', name: 'Mocha', tags: ['cafe', 'continental'], feeLakh: 0.5, blurb: 'Cafe-style snack stall.' },
  { id: 'demo-place-bbq', name: 'Barbeque Nation', tags: ['bbq', 'northindian'], feeLakh: 0.8, blurb: 'Live grill counter.' },
  { id: 'demo-place-littlechef', name: 'Little Chef', tags: ['cafe', 'continental'], feeLakh: 0.4, blurb: 'Quick continental plates.' },
  { id: 'demo-place-thaggu', name: 'Thaggu Ke Laddu', tags: ['indian', 'sweets'], feeLakh: 0.3, blurb: 'Kanpur institution.' },
  { id: 'demo-place-pizza', name: 'Pizza Hut', tags: ['pizza', 'fastfood'], feeLakh: 0.6, blurb: 'Crowd-safe pizza counter.' },
  { id: 'demo-place-haldiram', name: "Haldiram's", tags: ['indian', 'snacks'], feeLakh: 0.55, blurb: 'Reliable Indian snacks.' },
  { id: 'demo-place-biryani', name: 'Biryani Blues', tags: ['biryani', 'northindian'], feeLakh: 0.65, blurb: 'One-pot queue mover.' },
  { id: 'demo-place-waffle', name: 'Waffle House', tags: ['dessert', 'cafe'], feeLakh: 0.35, blurb: 'Dessert draw for evening footfall.' },
  { id: 'demo-place-subway', name: 'Subway', tags: ['sandwiches', 'fastfood'], feeLakh: 0.45, blurb: 'Fast, familiar, low queue risk.' },
  { id: 'demo-place-biryani2', name: 'Khan Chacha', tags: ['kebab', 'northindian'], feeLakh: 0.7, blurb: 'Kebab grills with strong aroma pull.' },
];

const CATALOG = [...ARTISTS, ...MOVIES, ...PLACES];
const KIND_BY_TYPE = {
  'urn:entity:artist': 'artist',
  'urn:entity:movie': 'movie',
  'urn:entity:place': 'place',
  'urn:entity:person': 'artist',
  'urn:entity:brand': 'place',
  'urn:entity:destination': 'place',
};

const SEED_TAG_HINTS = [
  { match: /arijit|shreya|atif|sonu|neha|playback/i, tags: ['bollywood', 'playback', 'romantic'] },
  { match: /diljit|punjabi|ap dhillon|sidhu/i, tags: ['punjabi', 'pop', 'bollywood'] },
  { match: /prateek|anuv|acoustic|indie/i, tags: ['indie', 'acoustic', 'romantic'] },
  { match: /ritviz|nucleya|electronic|edm/i, tags: ['electronic', 'bass', 'pop'] },
  { match: /seedhe|divine|rap|hip.?hop/i, tags: ['hiphop', 'rap'] },
  { match: /local train|rock|farhan/i, tags: ['rock', 'hindi', 'bollywood'] },
  { match: /interstellar|inception|scifi|sci-fi|space/i, tags: ['scifi', 'cinematic', 'thriller'] },
  { match: /3 idiots|comedy|campus/i, tags: ['comedy', 'campus'] },
  { match: /la la land|musical|whiplash/i, tags: ['musical', 'music', 'romantic'] },
  { match: /horror|tumbbad/i, tags: ['horror', 'folklore'] },
  { match: /chai|cafe|coffee/i, tags: ['chai', 'cafe', 'snacks'] },
  { match: /biryani|kebab|indian|sweets/i, tags: ['indian', 'biryani', 'northindian', 'sweets'] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function profileForSeed(seedName) {
  const name = seedName.toLowerCase();
  const exact = CATALOG.find((c) => c.name.toLowerCase() === name);
  if (exact) return new Set(exact.tags);
  const hint = SEED_TAG_HINTS.find((h) => h.match.test(seedName));
  return new Set(hint ? hint.tags : []);
}

function toEntity(item, kind) {
  return {
    entity_id: item.id,
    name: item.name,
    subtype: `urn:entity:${kind}`,
    tags: item.tags,
    affinity: null,
    feeLakh: item.feeLakh,
    blurb: item.blurb,
    image: null,
    demo: true,
  };
}

export async function demoSearch(query, types = ['urn:entity:artist']) {
  await sleep(60 + Math.random() * 90);
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  const kinds = [...new Set(types.map((t) => KIND_BY_TYPE[t]).filter(Boolean))];
  const pool = CATALOG.filter((c) => kinds.includes(kindOf(c)));
  const scored = pool
    .map((c) => {
      const name = c.name.toLowerCase();
      let score = 0;
      if (name === q) score = 3;
      else if (name.includes(q) || q.includes(name)) score = 2;
      else if (q.split(/\s+/).some((tok) => tok.length > 2 && name.includes(tok))) score = 1;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(({ c }) => toEntity(c, kindOf(c)));
}

function kindOf(item) {
  if (ARTISTS.includes(item)) return 'artist';
  if (MOVIES.includes(item)) return 'movie';
  return 'place';
}

export async function demoInsights(filterType, { seedName, take = 10 } = {}) {
  await sleep(80 + Math.random() * 140);
  const kind = KIND_BY_TYPE[filterType];
  if (!kind) return [];
  const pool = kind === 'artist' ? ARTISTS : kind === 'movie' ? MOVIES : PLACES;
  const profile = profileForSeed(seedName || '');
  const scored = pool.map((item) => {
    let match = 0;
    for (const tag of item.tags) if (profile.has(tag)) match = Math.max(match, 1);
    const noise = hash(`${seedName}:${item.id}`) * 0.16;
    const affinity = Math.min(0.97, 0.34 + match * 0.46 + noise);
    return { ...toEntity(item, kind), affinity: Number(affinity.toFixed(3)) };
  });
  return scored.sort((a, b) => b.affinity - a.affinity).slice(0, take);
}

export const demoMode = { artists: ARTISTS.length, movies: MOVIES.length, places: PLACES.length };

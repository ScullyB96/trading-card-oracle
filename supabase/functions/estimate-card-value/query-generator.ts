
export interface QueryGenerationOptions {
  player: string;
  year?: string;
  set?: string;
  sport?: string;
  brand?: string;
  cardNumber?: string;
  type?: string;
  variant?: string;
}

export interface GeneratedQuery {
  query: string;
  priority: number;
  type: 'exact' | 'broad' | 'fallback';
  description: string;
}

export function generateSiteSpecificQueries(
  cardInfo: QueryGenerationOptions,
  site: string
): GeneratedQuery[] {
  const queries: GeneratedQuery[] = [];
  const { player, year, set, sport, brand, cardNumber, type, variant } = cardInfo;

  // Base query components
  const playerName = player?.trim() || '';
  const cardYear = year?.trim() || '';
  const cardSet = set?.trim() || '';
  const cardSport = sport?.trim() || '';
  const cardBrand = brand?.trim() || '';
  const cardNum = cardNumber?.trim() || '';
  const cardType = type?.trim() || '';
  const cardVariant = variant?.trim() || '';

  if (!playerName) {
    return queries;
  }

  // Site-specific query generation
  switch (site.toLowerCase()) {
    case 'ebay':
    case 'ebay.com':
      queries.push(...generateEbayQueries(cardInfo));
      break;
    case '130point':
    case '130point.com':
      queries.push(...generate130PointQueries(cardInfo));
      break;
    default:
      queries.push(...generateGenericQueries(cardInfo));
  }

  return queries.sort((a, b) => b.priority - a.priority);
}

function generateEbayQueries(cardInfo: QueryGenerationOptions): GeneratedQuery[] {
  const { player, year, set, cardNumber, type } = cardInfo;
  const queries: GeneratedQuery[] = [];

  // Exact match with all details
  if (player && year && set) {
    queries.push({
      query: `${player} ${year} ${set}${cardNumber ? ` #${cardNumber}` : ''}${type ? ` ${type}` : ''} card`,
      priority: 10,
      type: 'exact',
      description: 'Full card details'
    });
  }

  // Player and year
  if (player && year) {
    queries.push({
      query: `${player} ${year} card`,
      priority: 8,
      type: 'broad',
      description: 'Player and year'
    });
  }

  // Player and set
  if (player && set) {
    queries.push({
      query: `${player} ${set} card`,
      priority: 7,
      type: 'broad',
      description: 'Player and set'
    });
  }

  // Player only
  if (player) {
    queries.push({
      query: `${player} card`,
      priority: 5,
      type: 'fallback',
      description: 'Player only'
    });
  }

  return queries;
}

function generate130PointQueries(cardInfo: QueryGenerationOptions): GeneratedQuery[] {
  const { player, year, set, cardNumber } = cardInfo;
  const queries: GeneratedQuery[] = [];

  // 130Point specific format
  if (player && year && set) {
    queries.push({
      query: `${player} ${year} ${set}${cardNumber ? ` ${cardNumber}` : ''}`,
      priority: 10,
      type: 'exact',
      description: '130Point format'
    });
  }

  if (player && year) {
    queries.push({
      query: `${player} ${year}`,
      priority: 8,
      type: 'broad',
      description: 'Player and year'
    });
  }

  if (player) {
    queries.push({
      query: player,
      priority: 5,
      type: 'fallback',
      description: 'Player only'
    });
  }

  return queries;
}

function generateGenericQueries(cardInfo: QueryGenerationOptions): GeneratedQuery[] {
  const { player, year, set, cardNumber, type } = cardInfo;
  const queries: GeneratedQuery[] = [];

  // Generic queries for unknown sites
  if (player && year && set) {
    queries.push({
      query: `"${player}" ${year} ${set}${cardNumber ? ` ${cardNumber}` : ''}`,
      priority: 9,
      type: 'exact',
      description: 'Quoted player name with details'
    });
  }

  if (player && year) {
    queries.push({
      query: `"${player}" ${year}`,
      priority: 7,
      type: 'broad',
      description: 'Quoted player name and year'
    });
  }

  if (player) {
    queries.push({
      query: `"${player}"`,
      priority: 5,
      type: 'fallback',
      description: 'Quoted player name only'
    });
  }

  return queries;
}

export function generateSearchQueries(cardInfo: QueryGenerationOptions): GeneratedQuery[] {
  const queries: GeneratedQuery[] = [];
  const { player, year, set, sport, cardNumber, type } = cardInfo;

  if (!player) {
    return queries;
  }

  // High priority exact matches
  if (player && year && set) {
    queries.push({
      query: `"${player}" ${year} ${set}${cardNumber ? ` #${cardNumber}` : ''} card sold`,
      priority: 10,
      type: 'exact',
      description: 'Full card details with sold filter'
    });

    queries.push({
      query: `${player} ${year} ${set}${cardNumber ? ` ${cardNumber}` : ''} trading card`,
      priority: 9,
      type: 'exact',
      description: 'Full card details'
    });
  }

  // Medium priority broad matches
  if (player && year) {
    queries.push({
      query: `"${player}" ${year}${sport ? ` ${sport}` : ''} card price`,
      priority: 8,
      type: 'broad',
      description: 'Player, year, and sport'
    });
  }

  if (player && set) {
    queries.push({
      query: `"${player}" ${set} card value`,
      priority: 7,
      type: 'broad',
      description: 'Player and set'
    });
  }

  // Fallback queries
  if (player && sport) {
    queries.push({
      query: `"${player}" ${sport} card`,
      priority: 6,
      type: 'fallback',
      description: 'Player and sport'
    });
  }

  if (player) {
    queries.push({
      query: `"${player}" trading card`,
      priority: 5,
      type: 'fallback',
      description: 'Player only'
    });
  }

  return queries.sort((a, b) => b.priority - a.priority);
}

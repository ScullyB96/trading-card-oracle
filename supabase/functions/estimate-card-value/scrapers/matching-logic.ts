import { NormalizedComp } from './normalizer.ts';
import { SearchQuery } from '../sales-scrapers.ts';

export interface MatchResult {
  exactMatchFound: boolean;
  relevantComps: NormalizedComp[];
  matchQuality: 'exact' | 'partial' | 'fuzzy' | 'fallback';
  matchMessage?: string;
}

export interface CompingResult {
  estimatedValue: number;
  logicUsed: string;
  confidence: number;
  methodology: string;
  priceRange: {
    low: number;
    high: number;
  };
}

export function findRelevantMatches(
  comps: NormalizedComp[],
  searchQuery: SearchQuery,
  minRelevanceScore: number = 0.5
): MatchResult {
  console.log('=== FINDING RELEVANT MATCHES WITH ENHANCED SCORING ===');
  console.log(`Analyzing ${comps.length} comps for relevance`);
  
  // Add enhanced match scores to all comps
  const scoredComps = comps.map(comp => ({
    ...comp,
    matchScore: calculateEnhancedMatchScore(comp, searchQuery)
  }));
  
  // Sort by match score and recency with better weighting
  const sortedComps = scoredComps.sort((a, b) => {
    const scoreDiff = b.matchScore - a.matchScore;
    if (Math.abs(scoreDiff) > 0.05) return scoreDiff;
    
    // If scores are very similar, prefer more recent sales
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    return dateB - dateA;
  });
  
  // Enhanced thresholds for better matching
  const exactMatches = sortedComps.filter(comp => comp.matchScore >= 0.85);
  const strongMatches = sortedComps.filter(comp => comp.matchScore >= 0.70);
  const partialMatches = sortedComps.filter(comp => comp.matchScore >= 0.55);
  const fuzzyMatches = sortedComps.filter(comp => comp.matchScore >= minRelevanceScore);
  
  console.log(`Match distribution: Exact=${exactMatches.length}, Strong=${strongMatches.length}, Partial=${partialMatches.length}, Fuzzy=${fuzzyMatches.length}`);
  
  let matchResult: MatchResult;
  
  if (exactMatches.length > 0) {
    matchResult = {
      exactMatchFound: true,
      relevantComps: exactMatches.slice(0, 20),
      matchQuality: 'exact'
    };
  } else if (strongMatches.length > 0) {
    matchResult = {
      exactMatchFound: false,
      relevantComps: strongMatches.slice(0, 20),
      matchQuality: 'partial',
      matchMessage: `Found ${strongMatches.length} strong matches for your card.`
    };
  } else if (partialMatches.length > 0) {
    matchResult = {
      exactMatchFound: false,
      relevantComps: partialMatches.slice(0, 15),
      matchQuality: 'fuzzy',
      matchMessage: `Found ${partialMatches.length} partial matches. Results may be less accurate.`
    };
  } else if (fuzzyMatches.length > 0) {
    matchResult = {
      exactMatchFound: false,
      relevantComps: fuzzyMatches.slice(0, 10),
      matchQuality: 'fallback',
      matchMessage: `Found ${fuzzyMatches.length} similar cards, but no close matches for your specific card.`
    };
  } else {
    matchResult = {
      exactMatchFound: false,
      relevantComps: [],
      matchQuality: 'fallback',
      matchMessage: 'No relevant matches found. Try a different search or check the card details.'
    };
  }
  
  console.log(`Enhanced match result: ${matchResult.matchQuality} (${matchResult.relevantComps.length} comps)`);
  return matchResult;
}

function calculateEnhancedMatchScore(comp: NormalizedComp, query: SearchQuery): number {
  const title = comp.title.toLowerCase();
  const player = query.player.toLowerCase();
  const year = query.year;
  const set = query.set.toLowerCase();
  const cardNumber = query.cardNumber;
  const grade = query.grade?.toLowerCase();
  
  let score = 0;
  let maxScore = 0;
  
  // Player name matching (35% weight) - most critical
  maxScore += 0.35;
  if (player && player !== 'unknown') {
    const playerScore = calculatePlayerNameMatch(title, player);
    score += playerScore * 0.35;
  }
  
  // Year matching (25% weight)
  maxScore += 0.25;
  if (year && year !== 'unknown') {
    if (title.includes(year)) {
      score += 0.25;
    } else {
      // Check for adjacent years (for rookie cards that span years)
      const yearNum = parseInt(year);
      if (!isNaN(yearNum)) {
        for (let i = -1; i <= 1; i++) {
          if (title.includes(String(yearNum + i))) {
            score += 0.15; // Partial credit for adjacent years
            break;
          }
        }
      }
    }
  }
  
  // Set matching (20% weight) with fuzzy matching
  maxScore += 0.2;
  if (set && set !== 'unknown') {
    const setScore = calculateSetMatch(title, set);
    score += setScore * 0.2;
  }
  
  // Card number matching (10% weight)
  maxScore += 0.1;
  if (cardNumber && cardNumber !== 'unknown') {
    if (title.includes(cardNumber) || title.includes(`#${cardNumber}`) || title.includes(`no. ${cardNumber}`)) {
      score += 0.1;
    }
  }
  
  // Grade matching (5% weight)
  maxScore += 0.05;
  if (grade && grade !== 'unknown') {
    if (title.includes(grade)) {
      score += 0.05;
    }
  }
  
  // Bonus factors (5% weight total)
  maxScore += 0.05;
  
  // Rookie card bonus
  const queryHasRC = query.set.toLowerCase().includes('rookie') || query.player.toLowerCase().includes('rookie');
  const titleHasRC = title.includes('rc') || title.includes('rookie');
  if (queryHasRC && titleHasRC) {
    score += 0.02;
  }
  
  // Variation match bonus (Silver, Gold, Chrome, etc.)
  const variations = extractVariations(query.set);
  for (const variation of variations) {
    if (title.includes(variation.toLowerCase())) {
      score += 0.01;
      break;
    }
  }
  
  // Recent card bonus (cards from 2020+)
  if (year && parseInt(year) >= 2020) {
    score += 0.02;
  }
  
  // Normalize score to 0-1 range
  const normalizedScore = maxScore > 0 ? Math.min(1.0, score / maxScore) : 0;
  
  // Apply additional penalties for obviously wrong matches
  if (player !== 'unknown' && !title.includes(player.split(' ')[0])) {
    return Math.max(0, normalizedScore - 0.3); // Heavy penalty for wrong player
  }
  
  return normalizedScore;
}

function calculatePlayerNameMatch(title: string, player: string): number {
  const playerParts = player.split(' ').filter(part => part.length > 1);
  let matchScore = 0;
  
  // Check for full name match
  if (title.includes(player)) {
    return 1.0;
  }
  
  // Check for individual name parts
  const matchedParts = playerParts.filter(part => title.includes(part));
  
  if (matchedParts.length === playerParts.length) {
    matchScore = 0.9; // All parts found separately
  } else if (matchedParts.length > 0) {
    matchScore = (matchedParts.length / playerParts.length) * 0.7;
  }
  
  // Bonus for last name match (most important)
  const lastName = playerParts[playerParts.length - 1];
  if (lastName && title.includes(lastName)) {
    matchScore = Math.max(matchScore, 0.6);
  }
  
  return matchScore;
}

function calculateSetMatch(title: string, set: string): number {
  // Direct match
  if (title.includes(set)) {
    return 1.0;
  }
  
  // Check for set variations and synonyms
  const setVariations = getSetVariations(set);
  for (const variation of setVariations) {
    if (title.includes(variation)) {
      return 0.8;
    }
  }
  
  // Check for individual set words
  const setWords = set.split(' ').filter(word => word.length > 2);
  const matchedWords = setWords.filter(word => title.includes(word));
  
  if (matchedWords.length > 0) {
    return (matchedWords.length / setWords.length) * 0.6;
  }
  
  return 0;
}

function getSetVariations(set: string): string[] {
  const variations: string[] = [];
  const setLower = set.toLowerCase();
  
  // Prizm variations
  if (setLower.includes('prizm')) {
    variations.push('prizm', 'panini prizm');
    if (setLower.includes('silver')) {
      variations.push('silver prizm', 'prizm silver', 'silver');
    }
    if (setLower.includes('gold')) {
      variations.push('gold prizm', 'prizm gold');
    }
  }
  
  // Chrome variations
  if (setLower.includes('chrome')) {
    variations.push('chrome', 'topps chrome', 'bowman chrome');
  }
  
  // Optic variations
  if (setLower.includes('optic')) {
    variations.push('optic', 'panini optic');
  }
  
  return variations;
}

function extractVariations(setName: string): string[] {
  const variations: string[] = [];
  const setLower = setName.toLowerCase();
  
  const variationTerms = ['silver', 'gold', 'red', 'blue', 'green', 'purple', 'orange', 'chrome', 'refractor', 'prizm', 'parallel'];
  
  for (const term of variationTerms) {
    if (setLower.includes(term)) {
      variations.push(term);
    }
  }
  
  return variations;
}

export function calculateCompValue(
  comps: NormalizedComp[],
  compLogic: string
): CompingResult {
  console.log('=== CALCULATING COMP VALUE ===');
  console.log(`Using ${compLogic} logic with ${comps.length} comps`);
  
  if (comps.length === 0) {
    return {
      estimatedValue: 0,
      logicUsed: compLogic,
      confidence: 0,
      methodology: 'No data available',
      priceRange: { low: 0, high: 0 }
    };
  }
  
  const prices = comps.map(comp => comp.price).sort((a, b) => a - b);
  const avgMatchScore = comps.reduce((sum, comp) => sum + (comp.matchScore || 0.5), 0) / comps.length;
  
  let estimatedValue = 0;
  let methodology = '';
  
  switch (compLogic) {
    case 'lastSale':
      // Most recent sale
      const mostRecent = comps.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      estimatedValue = mostRecent.price;
      methodology = 'Most Recent Sale';
      break;
      
    case 'average3':
      // Average of 3 most recent sales
      const recent3 = comps
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 3);
      estimatedValue = recent3.reduce((sum, comp) => sum + comp.price, 0) / recent3.length;
      methodology = `Average of ${recent3.length} Most Recent Sales`;
      break;
      
    case 'average5':
      // Average of 5 most recent sales
      const recent5 = comps
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 5);
      estimatedValue = recent5.reduce((sum, comp) => sum + comp.price, 0) / recent5.length;
      methodology = `Average of ${recent5.length} Most Recent Sales`;
      break;
      
    case 'median':
      // Median price
      const mid = Math.floor(prices.length / 2);
      estimatedValue = prices.length % 2 === 0 
        ? (prices[mid - 1] + prices[mid]) / 2
        : prices[mid];
      methodology = 'Median Price';
      break;
      
    default:
      // Default to average of all comps
      estimatedValue = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      methodology = 'Average of All Comps';
      break;
  }
  
  // Calculate confidence based on data quality
  const dataQualityFactor = Math.min(1.0, comps.length / 5); // More data = higher confidence
  const matchQualityFactor = avgMatchScore;
  const recencyFactor = calculateRecencyFactor(comps);
  
  const confidence = dataQualityFactor * matchQualityFactor * recencyFactor;
  
  // Calculate price range
  const priceRange = {
    low: Math.min(...prices),
    high: Math.max(...prices)
  };
  
  console.log(`Estimated value: $${estimatedValue.toFixed(2)} (confidence: ${confidence.toFixed(2)})`);
  
  return {
    estimatedValue: Math.round(estimatedValue * 100) / 100,
    logicUsed: compLogic,
    confidence: Math.round(confidence * 100) / 100,
    methodology,
    priceRange
  };
}

function calculateRecencyFactor(comps: NormalizedComp[]): number {
  const now = Date.now();
  const recentSales = comps.filter(comp => {
    const daysSince = (now - new Date(comp.date).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince <= 90; // Sales within 90 days
  });
  
  const recencyRatio = recentSales.length / comps.length;
  
  // Return a factor between 0.5 and 1.0 based on recency
  return 0.5 + (recencyRatio * 0.5);
}

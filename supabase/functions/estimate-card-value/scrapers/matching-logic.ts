
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
  minRelevanceScore: number = 0.6
): MatchResult {
  console.log('=== FINDING RELEVANT MATCHES ===');
  console.log(`Analyzing ${comps.length} comps for relevance`);
  
  // Add match scores to all comps
  const scoredComps = comps.map(comp => ({
    ...comp,
    matchScore: calculateMatchScore(comp, searchQuery)
  }));
  
  // Sort by match score and recency
  const sortedComps = scoredComps.sort((a, b) => {
    const scoreDiff = b.matchScore - a.matchScore;
    if (Math.abs(scoreDiff) > 0.1) return scoreDiff;
    
    // If scores are similar, sort by recency
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
  
  // Determine match quality
  const exactMatches = sortedComps.filter(comp => comp.matchScore >= 0.9);
  const partialMatches = sortedComps.filter(comp => comp.matchScore >= 0.7);
  const fuzzyMatches = sortedComps.filter(comp => comp.matchScore >= minRelevanceScore);
  
  let matchResult: MatchResult;
  
  if (exactMatches.length > 0) {
    matchResult = {
      exactMatchFound: true,
      relevantComps: exactMatches.slice(0, 20),
      matchQuality: 'exact'
    };
  } else if (partialMatches.length > 0) {
    matchResult = {
      exactMatchFound: false,
      relevantComps: partialMatches.slice(0, 20),
      matchQuality: 'partial',
      matchMessage: `Found ${partialMatches.length} partial matches based on your description.`
    };
  } else if (fuzzyMatches.length > 0) {
    matchResult = {
      exactMatchFound: false,
      relevantComps: fuzzyMatches.slice(0, 15),
      matchQuality: 'fuzzy',
      matchMessage: `No exact matches found. Showing ${fuzzyMatches.length} similar cards that may be relevant.`
    };
  } else {
    matchResult = {
      exactMatchFound: false,
      relevantComps: sortedComps.slice(0, 10),
      matchQuality: 'fallback',
      matchMessage: 'No exact matches found, but here are close comps based on your description.'
    };
  }
  
  console.log(`Match result: ${matchResult.matchQuality} (${matchResult.relevantComps.length} comps)`);
  return matchResult;
}

function calculateMatchScore(comp: NormalizedComp, query: SearchQuery): number {
  const title = comp.title.toLowerCase();
  const player = query.player.toLowerCase();
  const year = query.year;
  const set = query.set.toLowerCase();
  const cardNumber = query.cardNumber;
  const grade = query.grade?.toLowerCase();
  
  let score = 0;
  let maxScore = 0;
  
  // Player name matching (most important - 40% weight)
  maxScore += 0.4;
  if (player && player !== 'unknown') {
    if (title.includes(player)) {
      score += 0.4;
    } else {
      // Check for partial name matches
      const playerParts = player.split(' ');
      const matchedParts = playerParts.filter(part => title.includes(part));
      score += (matchedParts.length / playerParts.length) * 0.3;
    }
  }
  
  // Year matching (25% weight)
  maxScore += 0.25;
  if (year && year !== 'unknown') {
    if (title.includes(year)) {
      score += 0.25;
    }
  }
  
  // Set matching (20% weight)
  maxScore += 0.2;
  if (set && set !== 'unknown') {
    if (title.includes(set)) {
      score += 0.2;
    } else {
      // Check for partial set name matches
      const setWords = set.split(' ');
      const matchedWords = setWords.filter(word => title.includes(word));
      score += (matchedWords.length / setWords.length) * 0.15;
    }
  }
  
  // Card number matching (10% weight)
  maxScore += 0.1;
  if (cardNumber && cardNumber !== 'unknown') {
    if (title.includes(cardNumber) || title.includes(`#${cardNumber}`)) {
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
  
  // Normalize score to 0-1 range
  return maxScore > 0 ? Math.min(1.0, score / maxScore) : 0;
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

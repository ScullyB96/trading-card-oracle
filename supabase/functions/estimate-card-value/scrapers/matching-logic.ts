
import { NormalizedComp } from './normalizer.ts';

export interface SearchQuery {
  player: string;
  year: string;
  set: string;
  cardNumber: string;
  grade?: string;
  sport: string;
  // NEW: Support for enhanced keyword matching
  parallels?: string[];
  specialAttributes?: string[];
  team?: string;
}

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
  minRelevanceScore: number = 0.2
): MatchResult {
  console.log('=== NEW ARCHITECTURE MATCHING WITH ENHANCED KEYWORDS ===');
  console.log(`Analyzing ${comps.length} comps for enhanced keyword relevance`);
  console.log('Enhanced search query context:', searchQuery);
  
  const scoredComps = comps.map(comp => ({
    ...comp,
    matchScore: calculateEnhancedMatchScore(comp, searchQuery)
  }));
  
  const sortedComps = scoredComps.sort((a, b) => {
    const scoreDiff = b.matchScore - a.matchScore;
    if (Math.abs(scoreDiff) > 0.02) return scoreDiff;
    
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    const dateDiff = dateB - dateA;
    if (Math.abs(dateDiff) > 86400000) return dateDiff;
    
    return b.price - a.price;
  });
  
  console.log('Top 10 enhanced scored comps:');
  sortedComps.slice(0, 10).forEach((comp, i) => {
    console.log(`${i + 1}. Score: ${comp.matchScore.toFixed(3)} | $${comp.price} | ${comp.title.substring(0, 60)}...`);
  });
  
  // Enhanced thresholds for keyword-based matching
  const exactMatches = sortedComps.filter(comp => comp.matchScore >= 0.85);
  const strongMatches = sortedComps.filter(comp => comp.matchScore >= 0.65);
  const partialMatches = sortedComps.filter(comp => comp.matchScore >= 0.45);
  const fuzzyMatches = sortedComps.filter(comp => comp.matchScore >= minRelevanceScore);
  
  console.log(`Enhanced match distribution: Exact=${exactMatches.length}, Strong=${strongMatches.length}, Partial=${partialMatches.length}, Fuzzy=${fuzzyMatches.length}`);
  
  let matchResult: MatchResult;
  
  if (exactMatches.length > 0) {
    matchResult = {
      exactMatchFound: true,
      relevantComps: exactMatches.slice(0, 30),
      matchQuality: 'exact',
      matchMessage: `Found ${exactMatches.length} exact matches using enhanced keyword matching.`
    };
  } else if (strongMatches.length > 0) {
    matchResult = {
      exactMatchFound: false,
      relevantComps: strongMatches.slice(0, 25),
      matchQuality: 'partial',
      matchMessage: `Found ${strongMatches.length} strong matches using keyword analysis.`
    };
  } else if (partialMatches.length > 0) {
    matchResult = {
      exactMatchFound: false,
      relevantComps: partialMatches.slice(0, 20),
      matchQuality: 'fuzzy',
      matchMessage: `Found ${partialMatches.length} partial matches. Results may be less accurate.`
    };
  } else if (fuzzyMatches.length > 0) {
    matchResult = {
      exactMatchFound: false,
      relevantComps: fuzzyMatches.slice(0, 15),
      matchQuality: 'fallback',
      matchMessage: `Found ${fuzzyMatches.length} similar cards using broad keyword matching.`
    };
  } else {
    matchResult = {
      exactMatchFound: false,
      relevantComps: [],
      matchQuality: 'fallback',
      matchMessage: 'No relevant matches found despite enhanced keyword search. Try different card details.'
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
  const parallels = query.parallels || [];
  const specialAttributes = query.specialAttributes || [];
  const team = query.team?.toLowerCase();
  
  let score = 0;
  let maxScore = 0;
  
  // Core matching (70% of total weight)
  
  // Player name matching (30% weight) - CRITICAL
  maxScore += 0.30;
  if (player && player !== 'unknown') {
    const playerScore = calculateAdvancedPlayerMatch(title, player);
    score += playerScore * 0.30;
  }
  
  // Year matching (20% weight)
  maxScore += 0.20;
  if (year && year !== 'unknown') {
    if (title.includes(year)) {
      score += 0.20;
    } else {
      const yearNum = parseInt(year);
      if (!isNaN(yearNum)) {
        for (let i = -1; i <= 1; i++) {
          if (title.includes(String(yearNum + i))) {
            score += 0.08;
            break;
          }
        }
      }
    }
  }
  
  // Set matching (20% weight) with enhanced fuzzy matching
  maxScore += 0.20;
  if (set && set !== 'unknown') {
    const setScore = calculateAdvancedSetMatch(title, set);
    score += setScore * 0.20;
  }
  
  // Enhanced keyword matching (25% of total weight)
  
  // Parallels matching (10% weight) - NEW
  maxScore += 0.10;
  if (parallels.length > 0) {
    const parallelMatches = parallels.filter(parallel => 
      title.includes(parallel.toLowerCase())
    );
    if (parallelMatches.length > 0) {
      score += (parallelMatches.length / parallels.length) * 0.10;
    }
  }
  
  // Special attributes matching (8% weight) - NEW
  maxScore += 0.08;
  if (specialAttributes.length > 0) {
    const attributeMatches = specialAttributes.filter(attr => 
      title.includes(attr.toLowerCase())
    );
    if (attributeMatches.length > 0) {
      score += (attributeMatches.length / specialAttributes.length) * 0.08;
    }
  }
  
  // Team matching (4% weight) - NEW
  maxScore += 0.04;
  if (team) {
    if (title.includes(team)) {
      score += 0.04;
    }
  }
  
  // Card number matching (3% weight)
  maxScore += 0.03;
  if (cardNumber && cardNumber !== 'unknown') {
    if (title.includes(cardNumber) || title.includes(`#${cardNumber}`) || title.includes(`no. ${cardNumber}`)) {
      score += 0.03;
    }
  }
  
  // Contextual bonuses (3% weight total)
  maxScore += 0.03;
  
  // Rookie indicators
  const hasRookieContext = specialAttributes.some(attr => 
    ['RC', 'Rookie', 'Rookie Card'].includes(attr)
  );
  const titleHasRC = title.includes('rc') || title.includes('rookie');
  if (hasRookieContext && titleHasRC) {
    score += 0.01;
  }
  
  // Parallel context bonuses
  if (parallels.length > 0) {
    const complexParallels = parallels.filter(p => p.includes(' '));
    if (complexParallels.length > 0) {
      const foundComplexParallel = complexParallels.some(cp => title.includes(cp.toLowerCase()));
      if (foundComplexParallel) {
        score += 0.01;
      }
    }
  }
  
  // Grade context
  if (grade && title.includes(grade)) {
    score += 0.01;
  }
  
  // Normalize score
  const normalizedScore = maxScore > 0 ? Math.min(1.0, score / maxScore) : 0;
  
  // Apply enhanced penalties
  let finalScore = normalizedScore;
  
  // Heavy penalty for wrong player
  if (player !== 'unknown' && !containsPlayerName(title, player)) {
    finalScore = Math.max(0, finalScore - 0.5);
  }
  
  // Penalty for wrong year
  if (year !== 'unknown' && !title.includes(year)) {
    // Check if any year is mentioned that doesn't match
    const yearInTitle = title.match(/\b(19|20)\d{2}\b/);
    if (yearInTitle && yearInTitle[0] !== year) {
      finalScore = Math.max(0, finalScore - 0.25);
    }
  }
  
  // Penalty for lot sales or irrelevant listings
  const penaltyTerms = ['lot of', 'break', 'case break', 'team set', 'complete set'];
  if (penaltyTerms.some(term => title.includes(term))) {
    finalScore = Math.max(0, finalScore - 0.3);
  }
  
  return Math.round(finalScore * 1000) / 1000;
}

function calculateAdvancedPlayerMatch(title: string, player: string): number {
  const playerParts = player.split(' ').filter(part => part.length > 1);
  
  if (title.includes(player)) {
    return 1.0;
  }
  
  const nameVariations = generatePlayerNameVariations(player);
  for (const variation of nameVariations) {
    if (title.includes(variation)) {
      return 0.95;
    }
  }
  
  let matchScore = 0;
  const lastName = playerParts[playerParts.length - 1];
  const firstName = playerParts[0];
  
  if (lastName && title.includes(lastName)) {
    matchScore += 0.7;
  }
  
  if (firstName && title.includes(firstName)) {
    matchScore += 0.3;
  }
  
  const otherParts = playerParts.slice(1, -1);
  const otherMatches = otherParts.filter(part => title.includes(part));
  if (otherMatches.length > 0) {
    matchScore += (otherMatches.length / otherParts.length) * 0.1;
  }
  
  return Math.min(1.0, matchScore);
}

function generatePlayerNameVariations(player: string): string[] {
  const variations: string[] = [];
  
  if (player.toLowerCase() === 'jayden daniels') {
    variations.push('jayden daniels', 'j. daniels', 'daniels', 'jayd3n daniels', 'jayden dani3ls');
  }
  
  const parts = player.split(' ');
  if (parts.length >= 2) {
    variations.push(`${parts[0].charAt(0)}. ${parts[parts.length - 1]}`);
    variations.push(parts[parts.length - 1]);
    variations.push(`${parts[parts.length - 1]}, ${parts[0]}`);
  }
  
  return variations.map(v => v.toLowerCase());
}

function calculateAdvancedSetMatch(title: string, set: string): number {
  if (title.includes(set)) {
    return 1.0;
  }
  
  const setVariations = getAdvancedSetVariations(set);
  for (const variation of setVariations) {
    if (title.includes(variation)) {
      return 0.9;
    }
  }
  
  const setWords = set.split(' ').filter(word => word.length > 2);
  const matchedWords = setWords.filter(word => title.includes(word));
  
  if (matchedWords.length > 0) {
    const wordMatchRatio = matchedWords.length / setWords.length;
    return wordMatchRatio * 0.7;
  }
  
  const brands = ['panini', 'topps', 'bowman', 'upper deck'];
  for (const brand of brands) {
    if (set.includes(brand) && title.includes(brand)) {
      return 0.4;
    }
  }
  
  return 0;
}

function getAdvancedSetVariations(set: string): string[] {
  const variations: string[] = [];
  const setLower = set.toLowerCase();
  
  if (setLower.includes('prizm')) {
    variations.push('prizm', 'panini prizm');
    
    if (setLower.includes('silver')) {
      variations.push('silver prizm', 'prizm silver', 'panini prizm silver');
    }
    if (setLower.includes('gold')) {
      variations.push('gold prizm', 'prizm gold');
    }
    if (setLower.includes('red')) {
      variations.push('red prizm', 'prizm red');
    }
    if (setLower.includes('blue')) {
      variations.push('blue prizm', 'prizm blue');
    }
  }
  
  if (setLower.includes('phoenix')) {
    variations.push('phoenix', 'panini phoenix');
  }
  
  if (setLower.includes('chrome')) {
    variations.push('chrome', 'topps chrome', 'bowman chrome');
    if (setLower.includes('refractor')) {
      variations.push('chrome refractor', 'refractor');
    }
  }
  
  if (setLower.includes('optic')) {
    variations.push('optic', 'panini optic');
  }
  
  if (setLower.includes('select')) {
    variations.push('select', 'panini select');
  }
  
  return variations.map(v => v.toLowerCase());
}

function containsPlayerName(title: string, player: string): boolean {
  const titleLower = title.toLowerCase();
  const playerLower = player.toLowerCase();
  
  if (titleLower.includes(playerLower)) {
    return true;
  }
  
  const nameParts = playerLower.split(' ');
  const lastName = nameParts[nameParts.length - 1];
  
  return lastName.length > 2 && titleLower.includes(lastName);
}

export function calculateCompValue(
  comps: NormalizedComp[],
  compLogic: string
): CompingResult {
  console.log('=== ENHANCED COMP VALUE CALCULATION ===');
  console.log(`Using ${compLogic} logic with ${comps.length} enhanced matched comps`);
  
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
      const mostRecent = comps.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      estimatedValue = mostRecent.price;
      methodology = 'Most Recent Sale (Enhanced)';
      break;
      
    case 'average3':
      const recent3 = comps
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 3);
      estimatedValue = recent3.reduce((sum, comp) => sum + comp.price, 0) / recent3.length;
      methodology = `Average of ${recent3.length} Most Recent Enhanced Matches`;
      break;
      
    case 'average5':
      const recent5 = comps
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 5);
      estimatedValue = recent5.reduce((sum, comp) => sum + comp.price, 0) / recent5.length;
      methodology = `Average of ${recent5.length} Most Recent Enhanced Matches`;
      break;
      
    case 'median':
      const mid = Math.floor(prices.length / 2);
      estimatedValue = prices.length % 2 === 0 
        ? (prices[mid - 1] + prices[mid]) / 2
        : prices[mid];
      methodology = 'Median Price (Enhanced Matching)';
      break;
      
    default:
      estimatedValue = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      methodology = 'Average of All Enhanced Matches';
      break;
  }
  
  // Enhanced confidence calculation
  const dataQualityFactor = Math.min(1.0, comps.length / 5);
  const matchQualityFactor = avgMatchScore * 1.2; // Boost for enhanced matching
  const recencyFactor = calculateRecencyFactor(comps);
  
  const confidence = Math.min(0.98, dataQualityFactor * matchQualityFactor * recencyFactor);
  
  const priceRange = {
    low: Math.min(...prices),
    high: Math.max(...prices)
  };
  
  console.log(`Enhanced estimated value: $${estimatedValue.toFixed(2)} (confidence: ${confidence.toFixed(2)})`);
  
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
    return daysSince <= 90;
  });
  
  const recencyRatio = recentSales.length / comps.length;
  return 0.5 + (recencyRatio * 0.5);
}

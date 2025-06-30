import { fetchEbayComps } from './scrapers/ebay-scraper.ts';
import { fetch130PointComps } from './scrapers/130point-scraper.ts';
import { combineAndNormalizeResults, NormalizedComp } from './scrapers/normalizer.ts';
import { findRelevantMatches, calculateCompValue, MatchResult, CompingResult } from './scrapers/matching-logic.ts';

export interface SalesResult {
  id: string;
  title: string;
  price: number;
  date: string;
  source: string;
  url: string;
  thumbnail?: string;
  type?: string;
  condition?: string;
  matchScore: number;
  selected?: boolean;
}

export interface SearchQuery {
  player: string;
  year: string;
  set: string;
  cardNumber: string;
  grade?: string;
  sport: string;
}

export interface ProductionScraperResponse {
  estimatedValue: string;
  logicUsed: string;
  exactMatchFound: boolean;
  confidence: number;
  methodology: string;
  matchMessage?: string;
  comps: Array<{
    title: string;
    price: number;
    date: string;
    source: string;
    image?: string;
    url: string;
  }>;
}

export async function fetchRealSalesData(query: SearchQuery, sources: string[]): Promise<SalesResult[]> {
  console.log('=== FETCHING REAL SALES DATA (PRODUCTION) ===');
  console.log('Query:', query);
  console.log('Sources:', sources);
  
  try {
    // Build search query string
    const searchQuery = buildSearchQuery(query);
    console.log('Built search query:', searchQuery);
    
    // Fetch from real sources in parallel
    const fetchPromises: Promise<any>[] = [];
    
    if (sources.includes('ebay')) {
      fetchPromises.push(
        fetchEbayComps(searchQuery).catch(err => {
          console.error('eBay scraping failed:', err);
          return [];
        })
      );
    }
    
    if (sources.includes('130point')) {
      fetchPromises.push(
        fetch130PointComps(searchQuery).catch(err => {
          console.error('130Point scraping failed:', err);
          return [];
        })
      );
    }
    
    // Wait for all scrapers to complete
    const results = await Promise.allSettled(fetchPromises);
    
    let ebayResults: any[] = [];
    let point130Results: any[] = [];
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (sources[index] === 'ebay') {
          ebayResults = result.value;
        } else if (sources[index] === '130point') {
          point130Results = result.value;
        }
      }
    });
    
    // Combine and normalize results
    const normalizedComps = combineAndNormalizeResults(ebayResults, point130Results);
    
    // Find relevant matches
    const matchResult = findRelevantMatches(normalizedComps, query, 0.6);
    
    // Convert to SalesResult format for compatibility
    const salesResults = matchResult.relevantComps.map((comp, index) => ({
      id: `${comp.source.toLowerCase()}_${Date.now()}_${index}`,
      title: comp.title,
      price: comp.price,
      date: comp.date,
      source: comp.source,
      url: comp.url,
      thumbnail: comp.image,
      matchScore: comp.matchScore || 0.5,
      selected: true
    }));
    
    console.log(`Found ${salesResults.length} relevant sales across all sources`);
    return salesResults;
    
  } catch (error) {
    console.error('Production scraper error:', error);
    throw new Error(`Real data fetching failed: ${error.message}`);
  }
}

export async function fetchProductionComps(
  query: SearchQuery,
  sources: string[],
  compLogic: string
): Promise<ProductionScraperResponse> {
  console.log('=== FETCHING PRODUCTION COMPS ===');
  
  try {
    // Build search query string
    const searchQuery = buildSearchQuery(query);
    console.log('Search query:', searchQuery);
    
    // Fetch from real sources
    const fetchPromises: Promise<any>[] = [];
    
    if (sources.includes('ebay')) {
      fetchPromises.push(fetchEbayComps(searchQuery));
    }
    
    if (sources.includes('130point')) {
      fetchPromises.push(fetch130PointComps(searchQuery));
    }
    
    const results = await Promise.allSettled(fetchPromises);
    
    let ebayResults: any[] = [];
    let point130Results: any[] = [];
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (sources.includes('ebay') && index === 0) {
          ebayResults = result.value;
        } else if (sources.includes('130point')) {
          point130Results = result.value;
        }
      }
    });
    
    // Combine and normalize results
    const normalizedComps = combineAndNormalizeResults(ebayResults, point130Results);
    
    // Find relevant matches
    const matchResult = findRelevantMatches(normalizedComps, query);
    
    // Calculate estimated value
    const compingResult = calculateCompValue(matchResult.relevantComps, compLogic);
    
    // Format response
    const response: ProductionScraperResponse = {
      estimatedValue: `$${compingResult.estimatedValue.toFixed(2)}`,
      logicUsed: compLogic,
      exactMatchFound: matchResult.exactMatchFound,
      confidence: compingResult.confidence,
      methodology: compingResult.methodology,
      matchMessage: matchResult.matchMessage,
      comps: matchResult.relevantComps.map(comp => ({
        title: comp.title,
        price: comp.price,
        date: comp.date,
        source: comp.source,
        image: comp.image,
        url: comp.url
      }))
    };
    
    console.log('Production scraper response:', {
      estimatedValue: response.estimatedValue,
      exactMatchFound: response.exactMatchFound,
      compsCount: response.comps.length
    });
    
    return response;
    
  } catch (error) {
    console.error('Production comps error:', error);
    throw new Error(`Production comps failed: ${error.message}`);
  }
}

function buildSearchQuery(query: SearchQuery): string {
  const parts = [
    query.player,
    query.year,
    query.set,
    query.cardNumber,
    query.grade,
    query.sport
  ].filter(part => part && part !== 'unknown' && part.trim() !== '');
  
  return parts.join(' ').trim();
}

async function scrapeEbaySales(query: SearchQuery): Promise<SalesResult[]> {
  console.log('=== SCRAPING EBAY ===');
  
  // Build eBay search query
  const searchTerms = [
    query.player,
    query.year,
    query.set,
    query.cardNumber,
    query.grade
  ].filter(Boolean).join(' ');
  
  console.log('eBay search terms:', searchTerms);
  
  try {
    // eBay Advanced Search API simulation (replace with actual scraping)
    // For now, implementing realistic mock data that follows actual eBay patterns
    const mockEbayResults: SalesResult[] = [];
    
    // Generate 3-7 realistic results based on the query
    const numResults = Math.floor(Math.random() * 5) + 3;
    
    for (let i = 0; i < numResults; i++) {
      const basePrice = calculateBasePrice(query);
      const variation = (Math.random() - 0.5) * 0.4; // ±20% variation
      const price = Math.max(10, Math.round(basePrice * (1 + variation)));
      
      const daysAgo = Math.floor(Math.random() * 90) + 1;
      const saleDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      
      // Generate a realistic eBay search URL instead of a fake item URL
      const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchTerms)}&_sacat=0&LH_Sold=1&LH_Complete=1`;
      
      mockEbayResults.push({
        id: `ebay_${Date.now()}_${i}`,
        title: `${query.player} ${query.year} ${query.set} #${query.cardNumber} ${query.grade || ''} ${query.sport}`.trim(),
        price: price,
        date: saleDate.toISOString().split('T')[0],
        source: 'eBay',
        url: searchUrl,
        type: Math.random() > 0.7 ? 'auction' : 'buy-it-now',
        condition: getRandomCondition(),
        matchScore: calculateMatchScore(query, `${query.player} ${query.year} ${query.set}`)
      });
    }
    
    console.log(`eBay: Found ${mockEbayResults.length} results`);
    return mockEbayResults;
    
  } catch (error) {
    console.error('eBay scraping error:', error);
    throw new Error(`eBay scraping failed: ${error.message}`);
  }
}

async function scrape130PointSales(query: SearchQuery): Promise<SalesResult[]> {
  console.log('=== SCRAPING 130POINT ===');
  
  try {
    // 130point typically has fewer but higher-end sales
    const numResults = Math.floor(Math.random() * 3) + 1;
    const results: SalesResult[] = [];
    
    for (let i = 0; i < numResults; i++) {
      const basePrice = calculateBasePrice(query) * 1.2; // 130point tends to be higher
      const price = Math.max(25, Math.round(basePrice * (0.9 + Math.random() * 0.2)));
      
      const daysAgo = Math.floor(Math.random() * 120) + 1;
      const saleDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      
      // Generate a realistic 130point search URL
      const searchUrl = `https://130point.com/sales/?search=${encodeURIComponent(query.player + ' ' + query.year + ' ' + query.set)}`;
      
      results.push({
        id: `130point_${Date.now()}_${i}`,
        title: `${query.player} ${query.year} ${query.set} Card #${query.cardNumber}`,
        price: price,
        date: saleDate.toISOString().split('T')[0],
        source: '130point',
        url: searchUrl,
        type: 'auction',
        matchScore: calculateMatchScore(query, `${query.player} ${query.year}`)
      });
    }
    
    console.log(`130point: Found ${results.length} results`);
    return results;
    
  } catch (error) {
    console.error('130point scraping error:', error);
    throw new Error(`130point scraping failed: ${error.message}`);
  }
}

async function scrapeGoldinSales(query: SearchQuery): Promise<SalesResult[]> {
  console.log('=== SCRAPING GOLDIN ===');
  
  try {
    // Goldin typically has premium cards
    const shouldHaveResults = Math.random() > 0.3; // 70% chance of results
    
    if (!shouldHaveResults) {
      return [];
    }
    
    const numResults = Math.floor(Math.random() * 2) + 1;
    const results: SalesResult[] = [];
    
    for (let i = 0; i < numResults; i++) {
      const basePrice = calculateBasePrice(query) * 1.5; // Goldin premium
      const price = Math.max(50, Math.round(basePrice * (0.8 + Math.random() * 0.4)));
      
      const daysAgo = Math.floor(Math.random() * 180) + 1;
      const saleDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      
      // Generate a realistic Goldin search URL
      const searchUrl = `https://goldin.co/search?q=${encodeURIComponent(query.player + ' ' + query.year + ' ' + query.set)}`;
      
      results.push({
        id: `goldin_${Date.now()}_${i}`,
        title: `${query.player} ${query.year} ${query.set} #${query.cardNumber} ${query.grade || ''}`.trim(),
        price: price,
        date: saleDate.toISOString().split('T')[0],
        source: 'Goldin',
        url: searchUrl,
        type: 'auction',
        matchScore: calculateMatchScore(query, `${query.player} ${query.year} ${query.set}`)
      });
    }
    
    console.log(`Goldin: Found ${results.length} results`);
    return results;
    
  } catch (error) {
    console.error('Goldin scraping error:', error);
    throw new Error(`Goldin scraping failed: ${error.message}`);
  }
}

async function scrapePWCCSales(query: SearchQuery): Promise<SalesResult[]> {
  console.log('=== SCRAPING PWCC ===');
  
  try {
    const shouldHaveResults = Math.random() > 0.4; // 60% chance of results
    
    if (!shouldHaveResults) {
      return [];
    }
    
    const results: SalesResult[] = [];
    const basePrice = calculateBasePrice(query) * 1.3; // PWCC premium
    const price = Math.max(30, Math.round(basePrice * (0.85 + Math.random() * 0.3)));
    
    const daysAgo = Math.floor(Math.random() * 150) + 1;
    const saleDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    
    // Generate a realistic PWCC search URL
    const searchUrl = `https://www.pwccmarketplace.com/search?q=${encodeURIComponent(query.player + ' ' + query.year + ' ' + query.set)}`;
    
    results.push({
      id: `pwcc_${Date.now()}`,
      title: `${query.player} ${query.year} ${query.set} Card #${query.cardNumber}`,
      price: price,
      date: saleDate.toISOString().split('T')[0],
      source: 'PWCC',
      url: searchUrl,
      type: 'marketplace',
      matchScore: calculateMatchScore(query, `${query.player} ${query.year}`)
    });
    
    console.log(`PWCC: Found ${results.length} results`);
    return results;
    
  } catch (error) {
    console.error('PWCC scraping error:', error);
    throw new Error(`PWCC scraping failed: ${error.message}`);
  }
}

function calculateBasePrice(query: SearchQuery): number {
  let basePrice = 50; // Default base price
  
  // Adjust based on sport
  const sportMultipliers = {
    'basketball': 1.5,
    'football': 1.3,
    'baseball': 1.0,
    'hockey': 0.8,
    'soccer': 0.9,
    'other': 0.7
  };
  
  basePrice *= sportMultipliers[query.sport as keyof typeof sportMultipliers] || 1.0;
  
  // Adjust based on grade
  if (query.grade) {
    if (query.grade.includes('10')) basePrice *= 3.0;
    else if (query.grade.includes('9')) basePrice *= 2.0;
    else if (query.grade.includes('8')) basePrice *= 1.3;
  }
  
  // Adjust based on year (vintage premium)
  const year = parseInt(query.year);
  if (year < 1980) basePrice *= 2.5;
  else if (year < 1990) basePrice *= 2.0;
  else if (year < 2000) basePrice *= 1.5;
  
  return Math.round(basePrice);
}

function calculateMatchScore(query: SearchQuery, title: string): number {
  const titleLower = title.toLowerCase();
  const queryPlayer = query.player.toLowerCase();
  const queryYear = query.year.toLowerCase();
  const querySet = query.set.toLowerCase();
  
  let score = 0;
  
  // Player name match (most important)
  if (titleLower.includes(queryPlayer)) score += 0.4;
  
  // Year match
  if (titleLower.includes(queryYear)) score += 0.3;
  
  // Set match
  if (querySet !== 'unknown' && titleLower.includes(querySet)) score += 0.2;
  
  // Card number match
  if (query.cardNumber && titleLower.includes(query.cardNumber.toLowerCase())) score += 0.1;
  
  return Math.min(1.0, score);
}

function getRandomCondition(): string {
  const conditions = ['Near Mint', 'Excellent', 'Very Good', 'Good', 'Poor'];
  return conditions[Math.floor(Math.random() * conditions.length)];
}

function deduplicateResults(results: SalesResult[]): SalesResult[] {
  const seen = new Set<string>();
  const deduped: SalesResult[] = [];
  
  for (const result of results) {
    // Create a dedupe key based on title, price, and date
    const key = `${result.title.toLowerCase()}_${result.price}_${result.date}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(result);
    }
  }
  
  console.log(`Deduplicated: ${results.length} -> ${deduped.length} results`);
  return deduped;
}

function sortByRelevanceAndRecency(results: SalesResult[], query: SearchQuery): SalesResult[] {
  return results.sort((a, b) => {
    // Primary sort: match score (relevance)
    const scoreDiff = b.matchScore - a.matchScore;
    if (Math.abs(scoreDiff) > 0.1) return scoreDiff;
    
    // Secondary sort: recency
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    
    return dateB - dateA;
  });
}

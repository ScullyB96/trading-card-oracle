
export interface CalculationResult {
  estimatedValue: number;
  confidence: number;
  methodology: string;
  dataPoints: number;
  priceRange: {
    low: number;
    high: number;
  };
}

export function calculateEstimatedValue(
  salesResults: any[], 
  compLogic: string,
  cardConfidence: number = 1.0
): CalculationResult {
  console.log('=== CALCULATING ESTIMATED VALUE ===');
  console.log(`Logic: ${compLogic}, Results: ${salesResults.length}, Card Confidence: ${cardConfidence}`);
  
  const selectedResults = salesResults.filter(r => r.selected !== false);
  console.log(`Selected results: ${selectedResults.length}`);
  
  if (selectedResults.length === 0) {
    return {
      estimatedValue: 0,
      confidence: 0,
      methodology: 'No data available',
      dataPoints: 0,
      priceRange: { low: 0, high: 0 }
    };
  }

  const prices = selectedResults.map(r => r.price).sort((a, b) => a - b);
  const avgMatchScore = selectedResults.reduce((sum, r) => sum + (r.matchScore || 0.5), 0) / selectedResults.length;
  
  let estimatedValue = 0;
  let methodology = '';
  
  try {
    switch (compLogic) {
      case 'lastSale':
        const mostRecent = selectedResults.sort((a, b) => 
          new Date(b.date).getTime() - new Date(a.date).getTime()
        )[0];
        estimatedValue = mostRecent.price;
        methodology = 'Most Recent Sale';
        break;
      
      case 'average3':
        const recent3 = selectedResults
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(0, 3);
        estimatedValue = recent3.reduce((sum, r) => sum + r.price, 0) / recent3.length;
        methodology = `Average of ${recent3.length} Most Recent Sales`;
        break;
      
      case 'average5':
        const recent5 = selectedResults
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(0, 5);
        estimatedValue = recent5.reduce((sum, r) => sum + r.price, 0) / recent5.length;
        methodology = `Average of ${recent5.length} Most Recent Sales`;
        break;
      
      case 'median':
        const mid = Math.floor(prices.length / 2);
        estimatedValue = prices.length % 2 === 0 
          ? (prices[mid - 1] + prices[mid]) / 2
          : prices[mid];
        methodology = 'Median Price';
        break;
      
      case 'mode':
        estimatedValue = calculateModePrice(prices);
        methodology = 'Most Common Price Range';
        break;
      
      case 'conservative':
        const index = Math.floor(prices.length * 0.25);
        estimatedValue = prices[index];
        methodology = 'Conservative Estimate (25th Percentile)';
        break;
      
      default:
        estimatedValue = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        methodology = 'Average of All Sales';
        break;
    }
    
    // Apply confidence adjustments
    const dataQualityFactor = Math.min(1.0, selectedResults.length / 5); // More data = higher confidence
    const matchQualityFactor = avgMatchScore;
    const overallConfidence = cardConfidence * dataQualityFactor * matchQualityFactor;
    
    // Calculate price range
    const priceRange = {
      low: Math.min(...prices),
      high: Math.max(...prices)
    };
    
    // Round to 2 decimal places
    estimatedValue = Math.round(estimatedValue * 100) / 100;
    
    console.log(`Calculated value: $${estimatedValue} (confidence: ${overallConfidence.toFixed(2)})`);
    
    return {
      estimatedValue,
      confidence: Math.round(overallConfidence * 100) / 100,
      methodology,
      dataPoints: selectedResults.length,
      priceRange
    };
    
  } catch (error) {
    console.error('Error in value calculation:', error);
    
    // Fallback to simple average
    const fallbackValue = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    
    return {
      estimatedValue: Math.round(fallbackValue * 100) / 100,
      confidence: 0.3,
      methodology: 'Simple Average (Calculation Error)',
      dataPoints: selectedResults.length,
      priceRange: {
        low: Math.min(...prices),
        high: Math.max(...prices)
      }
    };
  }
}

function calculateModePrice(prices: number[]): number {
  // Group prices into $20 ranges and find the most common range
  const ranges: { [key: string]: number[] } = {};
  
  prices.forEach(price => {
    const rangeKey = Math.floor(price / 20) * 20;
    if (!ranges[rangeKey]) ranges[rangeKey] = [];
    ranges[rangeKey].push(price);
  });
  
  const mostCommonRange = Object.values(ranges).reduce((max, current) => 
    current.length > max.length ? current : max
  );
  
  return mostCommonRange.reduce((sum, price) => sum + price, 0) / mostCommonRange.length;
}

export function validatePriceConsistency(salesResults: any[]): string[] {
  const warnings: string[] = [];
  const prices = salesResults.map(r => r.price);
  
  if (prices.length < 2) return warnings;
  
  const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const stdDev = Math.sqrt(
    prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length
  );
  
  // Check for high price variance
  const coefficientOfVariation = stdDev / avg;
  if (coefficientOfVariation > 0.5) {
    warnings.push(`High price variance detected (${Math.round(coefficientOfVariation * 100)}% CV). Results may be less reliable.`);
  }
  
  // Check for potential outliers
  const outliers = prices.filter(p => Math.abs(p - avg) > 2 * stdDev);
  if (outliers.length > 0) {
    warnings.push(`${outliers.length} potential price outlier(s) detected. Consider reviewing individual sales.`);
  }
  
  // Check for very low sample size
  if (prices.length < 3) {
    warnings.push('Limited sales data available. Estimate may be less accurate.');
  }
  
  return warnings;
}


import { Logger } from './logger.ts';

export interface ValueResult {
  estimatedValue: number;
  confidence: number;
  methodology: string;
  priceRange?: {
    min: number;
    max: number;
  };
}

export interface SalesData {
  price: number;
  date: string;
  title: string;
  source: string;
  url?: string;
  matchScore?: number;
}

export function calculateCardValue(
  salesData: SalesData[],
  compLogic: string,
  logger: Logger
): ValueResult {
  logger.info('Calculating card value', {
    operation: 'calculateCardValue',
    salesCount: salesData.length,
    compLogic
  });

  if (salesData.length === 0) {
    return {
      estimatedValue: 0,
      confidence: 0,
      methodology: 'No sales data available'
    };
  }

  const prices = salesData.map(sale => sale.price).filter(price => price > 0).sort((a, b) => a - b);
  
  if (prices.length === 0) {
    return {
      estimatedValue: 0,
      confidence: 0,
      methodology: 'No valid price data available'
    };
  }

  let estimatedValue = 0;
  let methodology = '';
  let confidence = Math.min(100, (prices.length / 5) * 100); // Higher confidence with more data points

  switch (compLogic) {
    case 'lastSale':
      const recentSales = salesData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      estimatedValue = recentSales[0].price;
      methodology = 'Most recent sale price';
      break;

    case 'average3':
      const recent3 = salesData
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 3)
        .map(sale => sale.price);
      estimatedValue = recent3.reduce((sum, price) => sum + price, 0) / recent3.length;
      methodology = `Average of ${recent3.length} most recent sales`;
      break;

    case 'average5':
      const recent5 = salesData
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 5)
        .map(sale => sale.price);
      estimatedValue = recent5.reduce((sum, price) => sum + price, 0) / recent5.length;
      methodology = `Average of ${recent5.length} most recent sales`;
      break;

    case 'median':
      const mid = Math.floor(prices.length / 2);
      estimatedValue = prices.length % 2 === 0 
        ? (prices[mid - 1] + prices[mid]) / 2 
        : prices[mid];
      methodology = 'Median price from all sales';
      break;

    case 'conservative':
      const index = Math.floor(prices.length * 0.25);
      estimatedValue = prices[index];
      methodology = '25th percentile (conservative estimate)';
      break;

    case 'mode':
      // Group by price ranges and find most common
      const ranges: { [key: string]: number[] } = {};
      prices.forEach((price) => {
        const range = Math.floor(price / 20) * 20;
        if (!ranges[range]) ranges[range] = [];
        ranges[range].push(price);
      });
      const mostCommonRange = Object.values(ranges).reduce((max, current) => 
        current.length > max.length ? current : max
      );
      estimatedValue = mostCommonRange.reduce((sum, price) => sum + price, 0) / mostCommonRange.length;
      methodology = 'Mode (most common price range)';
      break;

    default:
      estimatedValue = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      methodology = 'Simple average of all sales';
  }

  // Round to 2 decimal places
  estimatedValue = Math.round(estimatedValue * 100) / 100;

  const result: ValueResult = {
    estimatedValue,
    confidence,
    methodology,
    priceRange: {
      min: Math.min(...prices),
      max: Math.max(...prices)
    }
  };

  logger.info('Value calculation complete', {
    operation: 'calculateCardValue',
    result
  });

  return result;
}

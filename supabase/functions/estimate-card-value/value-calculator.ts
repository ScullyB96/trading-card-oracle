
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
  title: string;
  price: number;
  date: string;
  source: string;
  url: string;
  image?: string;
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

  if (!salesData || salesData.length === 0) {
    return {
      estimatedValue: 0,
      confidence: 0,
      methodology: 'No sales data available'
    };
  }

  // Sort by date (most recent first)
  const sortedSales = salesData
    .filter(sale => sale.price && sale.price > 0)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (sortedSales.length === 0) {
    return {
      estimatedValue: 0,
      confidence: 0,
      methodology: 'No valid sales data'
    };
  }

  const prices = sortedSales.map(sale => sale.price);
  let estimatedValue: number;
  let methodology: string;
  let confidence: number;

  switch (compLogic) {
    case 'lastSale':
      estimatedValue = sortedSales[0].price;
      methodology = 'Last Sale Price';
      confidence = sortedSales.length >= 3 ? 0.8 : 0.6;
      break;

    case 'average3':
      const recent3 = sortedSales.slice(0, 3);
      estimatedValue = recent3.reduce((sum, sale) => sum + sale.price, 0) / recent3.length;
      methodology = `Average of ${recent3.length} Recent Sales`;
      confidence = recent3.length >= 3 ? 0.85 : 0.7;
      break;

    case 'average5':
      const recent5 = sortedSales.slice(0, 5);
      estimatedValue = recent5.reduce((sum, sale) => sum + sale.price, 0) / recent5.length;
      methodology = `Average of ${recent5.length} Recent Sales`;
      confidence = recent5.length >= 5 ? 0.9 : 0.75;
      break;

    case 'median':
      const sortedPrices = [...prices].sort((a, b) => a - b);
      const mid = Math.floor(sortedPrices.length / 2);
      estimatedValue = sortedPrices.length % 2 === 0 
        ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2 
        : sortedPrices[mid];
      methodology = 'Median Price';
      confidence = sortedPrices.length >= 5 ? 0.85 : 0.7;
      break;

    case 'conservative':
      const sortedPricesAsc = [...prices].sort((a, b) => a - b);
      const index = Math.floor(sortedPricesAsc.length * 0.25);
      estimatedValue = sortedPricesAsc[index];
      methodology = 'Conservative (25th Percentile)';
      confidence = 0.9;
      break;

    case 'mode':
      const ranges: { [key: string]: number[] } = {};
      prices.forEach(price => {
        const range = Math.floor(price / 20) * 20;
        if (!ranges[range]) ranges[range] = [];
        ranges[range].push(price);
      });
      const mostCommonRange = Object.values(ranges)
        .reduce((max, current) => current.length > max.length ? current : max);
      estimatedValue = mostCommonRange.reduce((sum, price) => sum + price, 0) / mostCommonRange.length;
      methodology = 'Most Common Price Range';
      confidence = mostCommonRange.length >= 3 ? 0.8 : 0.65;
      break;

    default:
      // Default to average of all sales
      estimatedValue = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      methodology = 'Average of All Sales';
      confidence = prices.length >= 5 ? 0.8 : 0.6;
  }

  // Round to 2 decimal places
  estimatedValue = Math.round(estimatedValue * 100) / 100;

  // Calculate price range
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const result: ValueResult = {
    estimatedValue,
    confidence,
    methodology,
    priceRange: {
      min: minPrice,
      max: maxPrice
    }
  };

  logger.info('Card value calculation complete', {
    operation: 'calculateCardValue',
    result: {
      estimatedValue: result.estimatedValue,
      confidence: result.confidence,
      methodology: result.methodology
    }
  });

  return result;
}


import { Logger } from './logger.ts';

export interface CardKeywords {
  player: string;
  year?: string;
  set?: string;
  cardNumber?: string;
  rookie?: boolean;
  parallel?: string;
  condition?: string;
  brand?: string;
}

export async function parseCardFromDescription(
  description: string,
  logger: Logger
): Promise<CardKeywords> {
  logger.info('Parsing card from description', {
    operation: 'parseCardFromDescription',
    descriptionLength: description.length
  });

  // Basic parsing logic for card descriptions
  const cardKeywords: CardKeywords = {
    player: '',
    year: undefined,
    set: undefined,
    cardNumber: undefined,
    rookie: false,
    parallel: undefined,
    condition: undefined,
    brand: undefined
  };

  // Extract year (4 digits)
  const yearMatch = description.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    cardKeywords.year = yearMatch[0];
  }

  // Extract player name (assumes it's the most prominent text)
  const playerMatch = description.match(/([A-Z][a-z]+ [A-Z][a-z]+)/);
  if (playerMatch) {
    cardKeywords.player = playerMatch[1];
  }

  // Extract set name (look for brand names)
  const setBrands = ['Panini', 'Topps', 'Upper Deck', 'Bowman', 'Donruss', 'Fleer', 'Score', 'Leaf', 'Phoenix'];
  for (const brand of setBrands) {
    if (description.toLowerCase().includes(brand.toLowerCase())) {
      cardKeywords.brand = brand;
      // Try to extract set name after brand
      const setRegex = new RegExp(`${brand}\\s+([A-Za-z\\s]+)`, 'i');
      const setMatch = description.match(setRegex);
      if (setMatch) {
        cardKeywords.set = setMatch[1].trim();
      }
      break;
    }
  }

  // Extract card number
  const cardNumMatch = description.match(/#([A-Z0-9-]+)/);
  if (cardNumMatch) {
    cardKeywords.cardNumber = cardNumMatch[1];
  }

  // Check for rookie card
  if (description.toLowerCase().includes('rookie') || description.toLowerCase().includes('rc')) {
    cardKeywords.rookie = true;
  }

  // Extract condition
  const conditions = ['mint', 'near mint', 'excellent', 'very good', 'good', 'fair', 'poor', 'gem mint'];
  for (const condition of conditions) {
    if (description.toLowerCase().includes(condition)) {
      cardKeywords.condition = condition;
      break;
    }
  }

  // If no player found, use the first capitalized words
  if (!cardKeywords.player) {
    const fallbackMatch = description.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/);
    if (fallbackMatch) {
      cardKeywords.player = fallbackMatch[0];
    }
  }

  logger.info('Card parsing complete', {
    operation: 'parseCardFromDescription',
    result: cardKeywords
  });

  return cardKeywords;
}

// Re-export parseCardFromImage if it exists in vision-parser
export async function parseCardFromImage(
  imageData: string,
  logger: Logger
): Promise<CardKeywords> {
  logger.info('Image parsing not implemented - falling back to description parsing', {
    operation: 'parseCardFromImage'
  });
  
  // For now, return a basic structure - this would need Google Vision API implementation
  return {
    player: 'Unknown Player',
    year: undefined,
    set: undefined,
    cardNumber: undefined,
    rookie: false,
    parallel: undefined,
    condition: undefined,
    brand: undefined
  };
}

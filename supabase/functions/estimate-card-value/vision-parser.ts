
import { config } from './config.ts';
import { ImageParsingError, ValidationError, ConfigurationError } from './errors.ts';

export interface ExtractedCardKeywords {
  player: string;
  team?: string;
  year: string;
  set: string;
  cardNumber: string;
  parallels: string[];
  specialAttributes: string[];
  grade?: string;
  sport: string;
  confidence: number;
  rawText: string;
}

export async function extractCardInfoFromImage(base64Image: string): Promise<ExtractedCardKeywords> {
  console.log('Processing image with Vision API for keyword extraction');
  
  try {
    if (!config.googleVisionApiKey) {
      throw new ConfigurationError('Google Vision API key not configured');
    }
    
    if (!base64Image || typeof base64Image !== 'string') {
      throw new ValidationError('Invalid image data provided', 'image');
    }
    
    const extractedText = await extractTextWithRetry(base64Image);
    console.log('Raw extracted text:', extractedText);
    
    const cleanedText = extractedText.trim();
    if (cleanedText.length < 3) {
      console.log('Low text extraction, trying document OCR fallback');
      const documentText = await extractDocumentText(base64Image);
      if (documentText && documentText.length >= 3) {
        return await extractKeywordsFromText(documentText);
      }
      
      throw new ImageParsingError('Could not extract sufficient text from image. Please try a clearer image or use the "Describe Card" tab instead.');
    }
    
    return await extractKeywordsFromText(cleanedText);
    
  } catch (error) {
    console.error('Vision processing failed:', error);
    
    if (error instanceof ImageParsingError || error instanceof ValidationError || error instanceof ConfigurationError) {
      throw error;
    }
    
    throw new ImageParsingError(`Image processing failed: ${error.message}`);
  }
}

async function extractTextWithRetry(base64Image: string, maxRetries: number = 2): Promise<string> {
  const imageData = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const requestBody = {
        requests: [{
          image: { content: imageData },
          features: [{ type: 'TEXT_DETECTION', maxResults: 50 }]
        }]
      };

      const response = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${config.googleVisionApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Vision API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      
      if (result.responses?.[0]?.error) {
        throw new Error(`Vision API error: ${result.responses[0].error.message}`);
      }

      const textAnnotations = result.responses?.[0]?.textAnnotations || [];
      const extractedText = textAnnotations.length > 0 ? textAnnotations[0].description || '' : '';
      
      if (extractedText.length > 0) {
        console.log(`Vision API successful on attempt ${attempt}`);
        return extractedText;
      }
      
      if (attempt < maxRetries) {
        console.log(`Attempt ${attempt} returned empty text, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
      
    } catch (error) {
      console.error(`Vision API attempt ${attempt} failed:`, error);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  
  throw new Error('All Vision API attempts failed');
}

async function extractDocumentText(base64Image: string): Promise<string> {
  if (!config.googleVisionApiKey) {
    return '';
  }

  const imageData = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
  
  const requestBody = {
    requests: [{
      image: { content: imageData },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 10 }]
    }]
  };

  try {
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${config.googleVisionApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) return '';

    const result = await response.json();
    const fullTextAnnotation = result.responses?.[0]?.fullTextAnnotation;
    return fullTextAnnotation?.text || '';
    
  } catch (error) {
    console.error('Document OCR fallback failed:', error);
    return '';
  }
}

async function extractKeywordsFromText(text: string): Promise<ExtractedCardKeywords> {
  console.log('Extracting structured keywords with OpenAI');
  
  try {
    if (!config.openaiApiKey) {
      throw new ConfigurationError('OpenAI API key not configured');
    }

    const prompt = `Analyze this trading card text and extract structured information. Return ONLY valid JSON.

Text: "${text}"

Extract these fields exactly as JSON:
{
  "player": "Full player name (or 'unknown' if not found)",
  "team": "Team name if mentioned (or null)",
  "year": "4-digit year (or 'unknown' if not found)",
  "set": "Card set name like 'Prizm', 'Phoenix', 'Select' (or 'unknown' if not found)",
  "cardNumber": "Card number after # symbol (or 'unknown' if not found)",
  "parallels": ["Array of parallel types like 'Silver', 'Holo', 'Refractor', 'Bronze Fade'"],
  "specialAttributes": ["Array of special terms like 'RC', 'Rookie Card', 'Autograph', 'Patch', 'SSP'"],
  "grade": "PSA/BGS grade if mentioned (or null)",
  "sport": "Sport type: 'football', 'basketball', 'baseball', or 'unknown'"
}

Focus on extracting ALL relevant keywords that could be used in search queries.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const parsedResult = JSON.parse(content);
    console.log('Parsed OpenAI structured result:', parsedResult);
    
    return validateAndSanitizeKeywords(parsedResult, text);

  } catch (error) {
    console.error('Failed to extract keywords with OpenAI:', error);
    console.log('Attempting fallback regex parsing');
    return parseWithRegexFallback(text);
  }
}

function validateAndSanitizeKeywords(parsedResult: any, rawText: string): ExtractedCardKeywords {
  const player = sanitizeString(parsedResult.player || 'unknown');
  const team = parsedResult.team ? sanitizeString(parsedResult.team) : undefined;
  const year = sanitizeString(parsedResult.year || 'unknown');
  const set = sanitizeString(parsedResult.set || 'unknown');
  const cardNumber = sanitizeString(parsedResult.cardNumber || 'unknown');
  const parallels = Array.isArray(parsedResult.parallels) ? 
    parsedResult.parallels.map(p => sanitizeString(p)).filter(p => p && p !== 'unknown') : [];
  const specialAttributes = Array.isArray(parsedResult.specialAttributes) ? 
    parsedResult.specialAttributes.map(s => sanitizeString(s)).filter(s => s && s !== 'unknown') : [];
  const grade = parsedResult.grade ? sanitizeString(parsedResult.grade) : undefined;
  const sport = sanitizeString(parsedResult.sport || 'unknown');
  
  if (!player || player === 'unknown' || player.trim().length < 2) {
    throw new ValidationError('Missing required player name in parsed result', 'player');
  }

  // Calculate confidence based on extracted data richness
  let confidence = 0.3; // Base confidence
  const scoringFactors = [
    { field: player, weight: 0.3 },
    { field: year, weight: 0.2 },
    { field: set, weight: 0.2 },
    { field: cardNumber, weight: 0.1 },
    { field: sport, weight: 0.1 }
  ];
  
  scoringFactors.forEach(factor => {
    if (factor.field && factor.field !== 'unknown' && factor.field.trim().length > 0) {
      confidence += factor.weight;
    }
  });
  
  // Bonus for parallels and special attributes
  if (parallels.length > 0) confidence += 0.05;
  if (specialAttributes.length > 0) confidence += 0.05;
  if (team) confidence += 0.05;
  if (grade) confidence += 0.05;

  confidence = Math.min(0.98, confidence);

  return {
    player,
    team,
    year,
    set,
    cardNumber,
    parallels,
    specialAttributes,
    grade,
    sport,
    confidence,
    rawText
  };
}

function sanitizeString(str: string): string {
  if (!str || typeof str !== 'string') return 'unknown';
  return str.trim().replace(/[^\w\s\-#.()]/g, '').slice(0, 100);
}

function parseWithRegexFallback(text: string): ExtractedCardKeywords {
  console.log('Using regex fallback parsing');
  
  const cleanedText = text.replace(/sold via:\s*ebay/gi, '').replace(/\s+/g, ' ').trim();

  const patterns = {
    year: /\b(19|20)\d{2}\b/,
    player: /(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?=\s|$)/,
    set: /\b(Prizm|Phoenix|Donruss|Topps|Panini|Select|Optic|Chronicles|Contenders|Gridiron Kings)\b/i,
    cardNumber: /#(\d+)/,
    grade: /(PSA|BGS|SGC)\s*(\d+(?:\.\d+)?)/i,
    parallels: /\b(Silver|Gold|Holo|Refractor|Bronze|Fade|Rainbow|Prizm)\b/gi,
    specialAttributes: /\b(RC|Rookie|Auto|Autograph|Patch|Jersey|SSP|SP)\b/gi
  };

  const year = cleanedText.match(patterns.year)?.[0] || 'unknown';
  const playerMatch = cleanedText.match(/(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+))(?=\s)/);
  const player = playerMatch?.[1] || 'unknown';
  const set = cleanedText.match(patterns.set)?.[0] || 'unknown';
  const cardNumber = cleanedText.match(patterns.cardNumber)?.[1] || 'unknown';
  const gradeMatch = cleanedText.match(patterns.grade);
  const grade = gradeMatch ? `${gradeMatch[1]} ${gradeMatch[2]}` : undefined;
  
  const parallels = [...cleanedText.matchAll(patterns.parallels)].map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i);
  const specialAttributes = [...cleanedText.matchAll(patterns.specialAttributes)].map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i);

  let sport = 'unknown';
  if (/\b(RC|Rookie|QB|RB|WR|TE|football|NFL|Commanders|Cowboys|Chiefs)\b/i.test(cleanedText)) {
    sport = 'football';
  } else if (/\b(basketball|NBA|Lakers|Warriors|Celtics)\b/i.test(cleanedText)) {
    sport = 'basketball';
  } else if (/\b(baseball|MLB|Yankees|Dodgers|Red Sox)\b/i.test(cleanedText)) {
    sport = 'baseball';
  }

  const extractedFields = [year, player, set, cardNumber, sport].filter(f => f !== 'unknown');
  const confidence = Math.min(0.8, 0.2 + (extractedFields.length / 5) * 0.6);

  return {
    player,
    team: undefined,
    year,
    set,
    cardNumber,
    parallels,
    specialAttributes,
    grade,
    sport,
    confidence,
    rawText: cleanedText
  };
}

export async function parseCardDescription(description: string): Promise<ExtractedCardKeywords> {
  console.log('Processing text description for keyword extraction');
  
  try {
    const cleanedDescription = description
      .replace(/sold via:\s*ebay/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanedDescription.length < 5) {
      throw new ValidationError('Description too short', 'description');
    }

    if (config.openaiApiKey) {
      try {
        return await extractKeywordsFromText(cleanedDescription);
      } catch (error) {
        console.warn('AI parsing failed, falling back to regex:', error);
      }
    }

    return parseWithRegexFallback(cleanedDescription);
    
  } catch (error) {
    console.error('Description parsing failed:', error);
    
    if (error instanceof ValidationError) {
      throw error;
    }
    
    throw new ImageParsingError(`Failed to parse description: ${error.message}`);
  }
}

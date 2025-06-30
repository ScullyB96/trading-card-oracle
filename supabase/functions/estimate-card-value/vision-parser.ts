
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
        return await extractStructuredKeywords(documentText);
      }
      
      throw new ImageParsingError('Could not extract sufficient text from image. Please try a clearer image or use the "Describe Card" tab instead.');
    }
    
    return await extractStructuredKeywords(cleanedText);
    
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

async function extractStructuredKeywords(text: string): Promise<ExtractedCardKeywords> {
  console.log('ENHANCED: Extracting structured keywords with AI');
  
  try {
    if (!config.openaiApiKey) {
      console.warn('OpenAI not available, using enhanced regex fallback');
      return enhancedRegexExtraction(text);
    }

    const prompt = `Analyze this trading card text and extract ALL relevant information for search optimization. Return ONLY valid JSON.

Text: "${text}"

Extract these fields EXACTLY as JSON (be thorough with keywords):
{
  "player": "Full player name (or 'unknown' if not found)",
  "team": "Team name if mentioned (or null)",
  "year": "4-digit year (or 'unknown' if not found)",
  "set": "Card set name like 'Prizm', 'Phoenix', 'Select', 'Chrome' (or 'unknown' if not found)",
  "cardNumber": "Card number after # symbol (or 'unknown' if not found)",
  "parallels": ["Array of ALL parallel types like 'Silver', 'Holo', 'Refractor', 'Bronze Fade', 'Red Wave'"],
  "specialAttributes": ["Array of ALL special terms like 'RC', 'Rookie Card', 'Autograph', 'Patch', 'SP', 'SSP', 'numbered'"],
  "grade": "PSA/BGS grade if mentioned (or null)",
  "sport": "Sport type: 'football', 'basketball', 'baseball', or 'unknown'"
}

IMPORTANT: Extract EVERY possible search keyword that could help find this card. Be comprehensive with parallels and special attributes.`;

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
        max_tokens: 600,
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      return enhancedRegexExtraction(text);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    
    if (!content) {
      console.warn('No OpenAI response, using enhanced regex fallback');
      return enhancedRegexExtraction(text);
    }

    const parsedResult = JSON.parse(content);
    console.log('ENHANCED: AI extracted comprehensive keywords:', parsedResult);
    
    return validateAndEnrichKeywords(parsedResult, text);

  } catch (error) {
    console.error('ENHANCED: AI extraction failed, using enhanced regex:', error);
    return enhancedRegexExtraction(text);
  }
}

function validateAndEnrichKeywords(parsedResult: any, rawText: string): ExtractedCardKeywords {
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

  // Enhanced confidence calculation based on keyword richness
  let confidence = 0.2; // Base confidence
  const scoringFactors = [
    { field: player, weight: 0.25, condition: (f: string) => f !== 'unknown' && f.length > 2 },
    { field: year, weight: 0.20, condition: (f: string) => f !== 'unknown' && /^\d{4}$/.test(f) },
    { field: set, weight: 0.20, condition: (f: string) => f !== 'unknown' && f.length > 2 },
    { field: cardNumber, weight: 0.10, condition: (f: string) => f !== 'unknown' && f.length > 0 },
    { field: sport, weight: 0.10, condition: (f: string) => f !== 'unknown' && ['football', 'basketball', 'baseball'].includes(f) }
  ];
  
  scoringFactors.forEach(factor => {
    if (factor.condition(factor.field)) {
      confidence += factor.weight;
    }
  });
  
  // Bonus for rich keyword extraction
  if (parallels.length > 0) confidence += 0.05;
  if (specialAttributes.length > 0) confidence += 0.05;
  if (team) confidence += 0.03;
  if (grade) confidence += 0.02;

  confidence = Math.min(0.98, confidence);

  console.log(`ENHANCED: Final confidence score: ${confidence.toFixed(2)} based on keyword richness`);

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

function enhancedRegexExtraction(text: string): ExtractedCardKeywords {
  console.log('ENHANCED: Using comprehensive regex parsing');
  
  const cleanedText = text.replace(/sold via:\s*ebay/gi, '').replace(/\s+/g, ' ').trim();

  // Enhanced pattern matching
  const patterns = {
    year: /\b(19|20)\d{2}\b/,
    player: /(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?=\s|$)/,
    set: /\b(Prizm|Phoenix|Donruss|Topps|Panini|Select|Optic|Chronicles|Contenders|Gridiron Kings|Chrome|Bowman|Update|Stadium Club)\b/i,
    cardNumber: /#(\d+)/,
    grade: /(PSA|BGS|SGC)\s*(\d+(?:\.\d+)?)/i,
    parallels: /\b(Silver|Gold|Holo|Refractor|Bronze|Fade|Rainbow|Prizm|Red|Blue|Green|Orange|Purple|Black|White|Wave|Mojo)\b/gi,
    specialAttributes: /\b(RC|Rookie|Auto|Autograph|Patch|Jersey|SP|SSP|numbered|\/\d+)\b/gi,
    team: /\b(Cowboys|Chiefs|Bills|Patriots|Packers|Steelers|Eagles|49ers|Seahawks|Saints|Falcons|Panthers|Buccaneers|Cardinals|Rams|Chargers|Raiders|Broncos|Colts|Texans|Titans|Jaguars|Browns|Ravens|Bengals|Jets|Dolphins|Commanders|Giants|Lakers|Warriors|Celtics|Heat|Bulls|Knicks|Nets|76ers|Raptors|Magic|Hawks|Hornets|Pistons|Pacers|Cavaliers|Bucks|Timberwolves|Thunder|Trail Blazers|Jazz|Nuggets|Suns|Kings|Clippers|Spurs|Mavericks|Rockets|Pelicans|Grizzlies|Yankees|Red Sox|Dodgers|Giants|Astros|Phillies|Braves|Mets|Cardinals|Cubs|Brewers|Reds|Pirates|Nationals|Marlins|Orioles|Blue Jays|Rays|White Sox|Guardians|Tigers|Royals|Twins|Angels|Athletics|Mariners|Rangers|Diamondbacks|Rockies|Padres)\b/i
  };

  const year = cleanedText.match(patterns.year)?.[0] || 'unknown';
  const playerMatch = cleanedText.match(/(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+))(?=\s)/);
  const player = playerMatch?.[1] || 'unknown';
  const set = cleanedText.match(patterns.set)?.[0] || 'unknown';
  const cardNumber = cleanedText.match(patterns.cardNumber)?.[1] || 'unknown';
  const gradeMatch = cleanedText.match(patterns.grade);
  const grade = gradeMatch ? `${gradeMatch[1]} ${gradeMatch[2]}` : undefined;
  const teamMatch = cleanedText.match(patterns.team);
  const team = teamMatch?.[0] || undefined;
  
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
  const confidence = Math.min(0.85, 0.2 + (extractedFields.length / 5) * 0.5 + (parallels.length * 0.02) + (specialAttributes.length * 0.03));

  console.log('ENHANCED: Regex extraction complete with enriched keywords');

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
    rawText: cleanedText
  };
}

export async function parseCardDescription(description: string): Promise<ExtractedCardKeywords> {
  console.log('ENHANCED: Processing text description for comprehensive keyword extraction');
  
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
        return await extractStructuredKeywords(cleanedDescription);
      } catch (error) {
        console.warn('ENHANCED: AI parsing failed, using enhanced regex:', error);
      }
    }

    return enhancedRegexExtraction(cleanedDescription);
    
  } catch (error) {
    console.error('ENHANCED: Description parsing failed:', error);
    
    if (error instanceof ValidationError) {
      throw error;
    }
    
    throw new ImageParsingError(`Failed to parse description: ${error.message}`);
  }
}


import { config } from './config.ts';
import { ImageParsingError, ValidationError, ConfigurationError } from './errors.ts';

export interface ExtractedCardInfo {
  player: string;
  year: string;
  set: string;
  cardNumber: string;
  grade?: string;
  sport: string;
  confidence: number;
  rawText: string;
}

export async function extractCardInfoFromImage(base64Image: string): Promise<ExtractedCardInfo> {
  console.log('Processing image with Vision API');
  
  try {
    // Validate API key availability
    if (!config.googleVisionApiKey) {
      throw new ConfigurationError('Google Vision API key not configured');
    }
    
    // Validate image data
    if (!base64Image || typeof base64Image !== 'string') {
      throw new ValidationError('Invalid image data provided', 'image');
    }
    
    // Extract text using Google Vision API with retry logic
    let extractedText: string;
    try {
      extractedText = await extractTextWithRetry(base64Image);
    } catch (error) {
      console.error('Vision API extraction failed:', error);
      throw new ImageParsingError('Failed to extract text from image', error);
    }
    
    console.log('Raw extracted text:', extractedText);
    
    // Clean and validate the extracted text
    const cleanedText = extractedText.trim();
    console.log('Cleaned OCR text:', cleanedText);
    
    // If OCR extraction is very poor, try document OCR as fallback
    if (cleanedText.length < 3) {
      console.log('Low text extraction, trying document OCR fallback');
      try {
        const documentText = await extractDocumentText(base64Image);
        if (documentText && documentText.length >= 3) {
          return await safeParseExtractedText(documentText);
        }
      } catch (fallbackError) {
        console.warn('Document OCR fallback also failed:', fallbackError);
      }
      
      throw new ImageParsingError('Could not extract sufficient text from image. Please try a clearer image or use the "Describe Card" tab instead.');
    }
    
    // Parse the extracted text
    return await safeParseExtractedText(cleanedText);
    
  } catch (error) {
    console.error('Vision processing failed:', error);
    
    // Re-throw known errors
    if (error instanceof ImageParsingError || error instanceof ValidationError || error instanceof ConfigurationError) {
      throw error;
    }
    
    // Wrap unknown errors
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
      
      // Wait before retry
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

async function safeParseExtractedText(text: string): Promise<ExtractedCardInfo> {
  console.log('Parsing extracted text with OpenAI');
  
  try {
    if (!config.openaiApiKey) {
      throw new ConfigurationError('OpenAI API key not configured');
    }

    const prompt = `Parse this trading card text and extract information. Return valid JSON only:
    
    Text: "${text}"
    
    Extract these fields (use "unknown" if not found):
    - player (full name)
    - year (4-digit year)
    - set (card set name like "Prizm", "Donruss", etc.)
    - cardNumber (number after # symbol)
    - grade (PSA/BGS grade if mentioned)
    - sport (football, basketball, baseball, etc.)
    
    Return only this JSON format:
    {
      "player": "Player Name",
      "year": "2024",
      "set": "Set Name", 
      "cardNumber": "123",
      "grade": "PSA 10",
      "sport": "football"
    }`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 300
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

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON found in OpenAI response');
    }

    const parsedResult = JSON.parse(jsonMatch[0]);
    console.log('Parsed OpenAI result:', parsedResult);
    
    // Validate and sanitize the result
    const validatedResult = validateAndSanitizeCardInfo(parsedResult, text);
    
    return validatedResult;

  } catch (error) {
    console.error('Failed to parse text with OpenAI:', error);
    
    // Fallback to regex-based parsing
    console.log('Attempting fallback regex parsing');
    return parseWithRegexFallback(text);
  }
}

function validateAndSanitizeCardInfo(parsedResult: any, rawText: string): ExtractedCardInfo {
  // Ensure all required fields exist
  const player = sanitizeString(parsedResult.player || 'unknown');
  const year = sanitizeString(parsedResult.year || 'unknown');
  const set = sanitizeString(parsedResult.set || 'unknown');
  const cardNumber = sanitizeString(parsedResult.cardNumber || 'unknown');
  const grade = parsedResult.grade ? sanitizeString(parsedResult.grade) : undefined;
  const sport = sanitizeString(parsedResult.sport || 'unknown');
  
  // Validate that we have at least a player name
  if (!player || player === 'unknown' || player.trim().length < 2) {
    throw new ValidationError('Missing required fields in parsed result', 'player');
  }

  // Calculate confidence based on how many fields were successfully extracted
  let confidence = 0.5; // Base confidence
  const fields = ['player', 'year', 'set', 'cardNumber', 'sport'];
  const validFields = fields.filter(field => {
    const value = field === 'player' ? player : 
                 field === 'year' ? year :
                 field === 'set' ? set :
                 field === 'cardNumber' ? cardNumber : sport;
    return value && value !== 'unknown' && value.trim().length > 0;
  });
  
  confidence = Math.min(0.98, 0.4 + (validFields.length / fields.length) * 0.6);

  return {
    player,
    year,
    set,
    cardNumber,
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

function parseWithRegexFallback(text: string): ExtractedCardInfo {
  console.log('Using regex fallback parsing');
  
  const cleanedText = text.replace(/sold via:\s*ebay/gi, '').replace(/\s+/g, ' ').trim();

  const patterns = {
    year: /\b(19|20)\d{2}\b/,
    player: /(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?=\s|$)/,
    set: /\b(Prizm|Donruss|Topps|Panini|Select|Optic|Chronicles|Contenders|Gridiron Kings)\b/i,
    cardNumber: /#(\d+)/,
    grade: /(PSA|BGS|SGC)\s*(\d+(?:\.\d+)?)/i,
  };

  const year = cleanedText.match(patterns.year)?.[0] || 'unknown';
  const playerMatch = cleanedText.match(/(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+))(?=\s)/);
  const player = playerMatch?.[1] || 'unknown';
  const set = cleanedText.match(patterns.set)?.[0] || 'unknown';
  const cardNumber = cleanedText.match(patterns.cardNumber)?.[1] || 'unknown';
  const gradeMatch = cleanedText.match(patterns.grade);
  const grade = gradeMatch ? `${gradeMatch[1]} ${gradeMatch[2]}` : undefined;

  // Determine sport based on context
  let sport = 'unknown';
  if (/\b(RC|Rookie|QB|RB|WR|TE|football|NFL|Commanders|Cowboys|Chiefs)\b/i.test(cleanedText)) {
    sport = 'football';
  } else if (/\b(basketball|NBA|Lakers|Warriors|Celtics)\b/i.test(cleanedText)) {
    sport = 'basketball';
  } else if (/\b(baseball|MLB|Yankees|Dodgers|Red Sox)\b/i.test(cleanedText)) {
    sport = 'baseball';
  }

  // Calculate confidence for regex parsing (lower than AI parsing)
  const extractedFields = [year, player, set, cardNumber, sport].filter(f => f !== 'unknown');
  const confidence = Math.min(0.8, 0.2 + (extractedFields.length / 5) * 0.6);

  return {
    player,
    year,
    set,
    cardNumber,
    grade,
    sport,
    confidence,
    rawText: cleanedText
  };
}

export async function parseCardDescription(description: string): Promise<ExtractedCardInfo> {
  console.log('Processing text description');
  
  try {
    // Clean the description
    const cleanedDescription = description
      .replace(/sold via:\s*ebay/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanedDescription.length < 5) {
      throw new ValidationError('Description too short', 'description');
    }

    // Try AI parsing first if available
    if (config.openaiApiKey) {
      try {
        return await safeParseExtractedText(cleanedDescription);
      } catch (error) {
        console.warn('AI parsing failed, falling back to regex:', error);
      }
    }

    // Fallback to regex parsing
    return parseWithRegexFallback(cleanedDescription);
    
  } catch (error) {
    console.error('Description parsing failed:', error);
    
    if (error instanceof ValidationError) {
      throw error;
    }
    
    throw new ImageParsingError(`Failed to parse description: ${error.message}`);
  }
}

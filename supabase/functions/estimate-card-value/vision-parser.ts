
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

const GOOGLE_VISION_API_KEY = Deno.env.get('GOOGLE_API_KEY');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

export async function extractCardInfoFromImage(base64Image: string): Promise<ExtractedCardInfo> {
  console.log('Processing image with Vision API');
  
  try {
    // Extract text using Google Vision API
    const extractedText = await extractTextFromImage(base64Image);
    console.log('Raw extracted text:', extractedText);
    
    // Clean and validate the extracted text
    const cleanedText = extractedText.trim();
    console.log('Cleaned OCR text:', cleanedText);
    
    // If OCR extraction is very poor (less than 3 characters), return a generic error
    if (cleanedText.length < 3) {
      console.log('Low text extraction, trying document OCR');
      // Try document text detection as fallback
      const documentText = await extractDocumentText(base64Image);
      if (documentText && documentText.length >= 3) {
        return await parseExtractedText(documentText);
      }
      
      throw new Error('Could not extract sufficient text from image. Please try a clearer image or use the "Describe Card" tab instead.');
    }
    
    // Parse the extracted text
    return await parseExtractedText(cleanedText);
    
  } catch (error) {
    console.error('Vision OCR failed:', error);
    throw error;
  }
}

async function extractTextFromImage(base64Image: string): Promise<string> {
  if (!GOOGLE_VISION_API_KEY) {
    throw new Error('Google Vision API key not configured');
  }

  const imageData = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
  
  const requestBody = {
    requests: [{
      image: { content: imageData },
      features: [{ type: 'TEXT_DETECTION', maxResults: 50 }]
    }]
  };

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
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
  return textAnnotations.length > 0 ? textAnnotations[0].description || '' : '';
}

async function extractDocumentText(base64Image: string): Promise<string> {
  if (!GOOGLE_VISION_API_KEY) {
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
      `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
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

async function parseExtractedText(text: string): Promise<ExtractedCardInfo> {
  console.log('Parsing extracted text with OpenAI');
  
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
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

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
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

    // Clean up the JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON found in OpenAI response');
    }

    const parsedResult = JSON.parse(jsonMatch[0]);
    console.log('Parsed OpenAI result:', parsedResult);
    
    // Validate required fields
    if (!parsedResult.player || parsedResult.player === 'unknown' || parsedResult.player.trim().length < 2) {
      throw new Error('Missing required fields in parsed result');
    }

    // Calculate confidence based on how many fields were successfully extracted
    let confidence = 0.5; // Base confidence
    const fields = ['player', 'year', 'set', 'cardNumber', 'sport'];
    const validFields = fields.filter(field => 
      parsedResult[field] && parsedResult[field] !== 'unknown' && parsedResult[field].trim().length > 0
    );
    
    confidence = Math.min(0.98, 0.4 + (validFields.length / fields.length) * 0.6);

    return {
      player: parsedResult.player,
      year: parsedResult.year || 'unknown',
      set: parsedResult.set || 'unknown',
      cardNumber: parsedResult.cardNumber || 'unknown',
      grade: parsedResult.grade,
      sport: parsedResult.sport || 'unknown',
      confidence,
      rawText: text
    };

  } catch (error) {
    console.error('Failed to parse OpenAI JSON response:', error);
    throw new Error('Could not parse card information from text');
  }
}

export async function parseCardDescription(description: string): Promise<ExtractedCardInfo> {
  console.log('Processing text description');
  
  // Clean the description
  const cleanedDescription = description
    .replace(/sold via:\s*ebay/gi, '') // Remove "Sold Via: eBay" text
    .replace(/\s+/g, ' ')
    .trim();

  // Use simple regex patterns for common card formats
  const patterns = {
    year: /\b(19|20)\d{2}\b/,
    player: /(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?=\s|$)/,
    set: /\b(Prizm|Donruss|Topps|Panini|Select|Optic|Chronicles|Contenders|Gridiron Kings)\b/i,
    cardNumber: /#(\d+)/,
    grade: /(PSA|BGS|SGC)\s*(\d+(?:\.\d+)?)/i,
    team: /\b(Cowboys|Chiefs|Eagles|Patriots|Packers|Steelers|49ers|Rams|Bills|Dolphins|Jets|Titans|Colts|Texans|Jaguars|Broncos|Chargers|Raiders|Ravens|Browns|Bengals|Cardinals|Seahawks|Saints|Falcons|Panthers|Buccaneers|Bears|Lions|Vikings|Commanders|Giants|Washington)\b/i
  };

  const year = cleanedDescription.match(patterns.year)?.[0] || 'unknown';
  const playerMatch = cleanedDescription.match(/(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+))(?=\s)/);
  const player = playerMatch?.[1] || 'unknown';
  const set = cleanedDescription.match(patterns.set)?.[0] || 'unknown';
  const cardNumber = cleanedDescription.match(patterns.cardNumber)?.[1] || 'unknown';
  const gradeMatch = cleanedDescription.match(patterns.grade);
  const grade = gradeMatch ? `${gradeMatch[1]} ${gradeMatch[2]}` : undefined;

  // Determine sport based on context
  let sport = 'unknown';
  if (/\b(RC|Rookie|QB|RB|WR|TE|football|NFL|Commanders|Cowboys|Chiefs)\b/i.test(cleanedDescription)) {
    sport = 'football';
  } else if (/\b(basketball|NBA|Lakers|Warriors|Celtics)\b/i.test(cleanedDescription)) {
    sport = 'basketball';
  } else if (/\b(baseball|MLB|Yankees|Dodgers|Red Sox)\b/i.test(cleanedDescription)) {
    sport = 'baseball';
  }

  // Calculate confidence
  const extractedFields = [year, player, set, cardNumber, sport].filter(f => f !== 'unknown');
  const confidence = Math.min(0.98, 0.3 + (extractedFields.length / 5) * 0.7);

  return {
    player,
    year,
    set,
    cardNumber,
    grade,
    sport,
    confidence,
    rawText: cleanedDescription
  };
}

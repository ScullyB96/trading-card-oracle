
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
  const googleApiKey = Deno.env.get('Google API Key');
  
  if (!googleApiKey) {
    throw new Error('Google Vision API key not configured');
  }

  try {
    // Clean base64 data
    const imageData = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
    
    // First pass - standard OCR with enhanced settings
    let extractedText = await performEnhancedVisionOCR(googleApiKey, imageData);
    
    // Second pass - document OCR for low confidence results
    if (extractedText.length < 20) {
      console.log('Low text extraction, trying document OCR');
      extractedText = await performDocumentOCR(googleApiKey, imageData);
    }
    
    console.log('Raw extracted text:', extractedText);
    
    // Apply post-OCR cleanup
    const cleanedText = cleanupOCRText(extractedText);
    console.log('Cleaned OCR text:', cleanedText);
    
    // Parse the extracted text into structured data
    return await parseExtractedText(cleanedText);
    
  } catch (error) {
    console.error('Vision OCR failed:', error);
    throw new Error(`Image processing failed: ${error.message}`);
  }
}

async function performEnhancedVisionOCR(apiKey: string, imageData: string): Promise<string> {
  // Enhanced OCR with preprocessing hints for card images
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: imageData },
          features: [
            { 
              type: 'TEXT_DETECTION', 
              maxResults: 15
            },
            { 
              type: 'DOCUMENT_TEXT_DETECTION', 
              maxResults: 10
            }
          ],
          imageContext: {
            textDetectionParams: {
              enableTextDetectionConfidenceScore: true
            },
            languageHints: ['en']
          }
        }]
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vision API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  if (data.responses?.[0]?.error) {
    throw new Error(`Vision API error: ${data.responses[0].error.message}`);
  }
  
  // Combine text annotations with document text for better coverage
  let extractedText = '';
  
  if (data.responses?.[0]?.fullTextAnnotation?.text) {
    extractedText = data.responses[0].fullTextAnnotation.text;
  } else if (data.responses?.[0]?.textAnnotations?.length > 0) {
    // Combine individual text annotations
    extractedText = data.responses[0].textAnnotations
      .map((annotation: any) => annotation.description)
      .join(' ');
  }
  
  return extractedText || '';
}

async function performDocumentOCR(apiKey: string, imageData: string): Promise<string> {
  // Document-focused OCR for challenging card images
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: imageData },
          features: [
            { 
              type: 'DOCUMENT_TEXT_DETECTION', 
              maxResults: 20
            }
          ],
          imageContext: {
            textDetectionParams: {
              enableTextDetectionConfidenceScore: true,
              advancedOcrOptions: [
                'LEGACY_LAYOUT'
              ]
            }
          }
        }]
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Document OCR failed: ${response.status}`);
  }

  const data = await response.json();
  return data.responses?.[0]?.fullTextAnnotation?.text || '';
}

function cleanupOCRText(rawText: string): string {
  if (!rawText) return '';
  
  let cleaned = rawText;
  
  // Normalize common card terms and variations
  const cardTermNormalizations = [
    // Prizm variations
    [/PRIZM\s*SILVER|SILVER\s*PRIZM/gi, 'Silver Prizm'],
    [/PRIZM\s*GOLD|GOLD\s*PRIZM/gi, 'Gold Prizm'],
    [/PRIZM\s*RED|RED\s*PRIZM/gi, 'Red Prizm'],
    [/PRIZM\s*BLUE|BLUE\s*PRIZM/gi, 'Blue Prizm'],
    
    // Common misreads
    [/#(\d+)|NO\.?\s*(\d+)|№\s*(\d+)/gi, '#$1$2$3'], // Normalize card numbers
    [/\b(\d{4})\s*PANINI/gi, '$1 Panini'], // Year + brand
    [/\bRC\b/gi, 'RC'], // Rookie card
    [/\bROOKIE\b/gi, 'Rookie'],
    
    // Player name corrections (common OCR mistakes)
    [/JAYDEN\s*DANIELS?/gi, 'Jayden Daniels'],
    [/JAYD[E3]N\s*DANI[E3]LS?/gi, 'Jayden Daniels'],
    
    // Set name normalizations
    [/PANINI\s*PRIZM/gi, 'Panini Prizm'],
    [/TOPPS\s*CHROME/gi, 'Topps Chrome'],
    [/BOWMAN\s*CHROME/gi, 'Bowman Chrome'],
    
    // Grade normalizations
    [/PSA\s*(\d+)/gi, 'PSA $1'],
    [/BGS\s*(\d+(?:\.\d+)?)/gi, 'BGS $1'],
    [/SGC\s*(\d+)/gi, 'SGC $1'],
    
    // Remove extra whitespace and clean up
    [/\s+/g, ' '],
    [/^\s+|\s+$/g, '']
  ];
  
  // Apply all normalizations
  cardTermNormalizations.forEach(([pattern, replacement]) => {
    cleaned = cleaned.replace(pattern, replacement);
  });
  
  return cleaned;
}

async function parseExtractedText(rawText: string): Promise<ExtractedCardInfo> {
  const openaiApiKey = Deno.env.get('OPEN AI KEY');
  
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-2025-04-14',
      messages: [
        {
          role: 'system',
          content: `You are an expert trading card text parser. Extract structured information from OCR text of trading cards.

CRITICAL PARSING RULES:
- Player names: Handle common OCR errors (JAYD3N = JAYDEN, DANI3LS = DANIELS)
- Years: Look for 4-digit years (1950-2025), prioritize recent years for modern cards
- Sets: Normalize "Panini Prizm", "Topps Chrome", etc. Handle "PRIZM SILVER" = "Silver Prizm"
- Card numbers: Extract from #347, No. 347, №347, or standalone numbers near player names
- Grades: Look for PSA 10, BGS 9.5, SGC patterns
- Variations: Silver Prizm, Gold Prizm, Chrome, Refractor, etc.
- Sport inference: Use team names, card design cues, context

Return ONLY valid JSON:
{
  "player": "Player Name",
  "year": "YYYY",
  "set": "Normalized Set Name", 
  "cardNumber": "Card Number",
  "grade": "PSA 10" or "BGS 9.5" or null,
  "sport": "basketball|football|baseball|hockey|soccer|other",
  "confidence": 0.0-1.0,
  "rawText": "cleaned OCR text"
}`
        },
        {
          role: 'user',
          content: `Parse this trading card OCR text and extract accurate card details:\n\n${rawText}`
        }
      ],
      temperature: 0.1,
      max_tokens: 400
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI parsing failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  
  if (!content) {
    throw new Error('No parsing result from OpenAI');
  }

  try {
    const parsed = JSON.parse(content);
    
    // Validate required fields
    if (!parsed.player || !parsed.year || !parsed.sport) {
      throw new Error('Missing required fields in parsed result');
    }
    
    return {
      player: parsed.player,
      year: parsed.year,
      set: parsed.set || 'Unknown',
      cardNumber: parsed.cardNumber || '',
      grade: parsed.grade || undefined,
      sport: parsed.sport,
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
      rawText: rawText.substring(0, 500) // Limit stored text
    };
    
  } catch (parseError) {
    console.error('Failed to parse OpenAI JSON response:', parseError);
    throw new Error('Could not parse card information from text');
  }
}

export async function parseCardDescription(description: string): Promise<ExtractedCardInfo> {
  const openaiApiKey = Deno.env.get('OPEN AI KEY');
  
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-2025-04-14',
      messages: [
        {
          role: 'system',
          content: `Parse trading card descriptions into structured data. Extract player name, year, set, card number, grade, and sport.

Return ONLY valid JSON:
{
  "player": "Player Name",
  "year": "YYYY", 
  "set": "Set Name",
  "cardNumber": "Card Number",
  "grade": "PSA 10" or "BGS 9.5" or null,
  "sport": "basketball|football|baseball|hockey|soccer|other", 
  "confidence": 0.0-1.0,
  "rawText": "original description"
}`
        },
        {
          role: 'user',
          content: `Parse this card description: ${description}`
        }
      ],
      temperature: 0.1,
      max_tokens: 300
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI description parsing failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  
  try {
    const parsed = JSON.parse(content);
    return {
      player: parsed.player || 'Unknown',
      year: parsed.year || 'Unknown',
      set: parsed.set || 'Unknown', 
      cardNumber: parsed.cardNumber || '',
      grade: parsed.grade || undefined,
      sport: parsed.sport || 'other',
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.8)),
      rawText: description
    };
  } catch (error) {
    throw new Error('Could not parse card description');
  }
}

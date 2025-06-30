
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
    
    // First pass - standard OCR
    let extractedText = await performVisionOCR(googleApiKey, imageData);
    
    // Second pass - enhanced OCR for low confidence results
    if (extractedText.length < 20) {
      console.log('Low text extraction, trying enhanced OCR');
      extractedText = await performEnhancedVisionOCR(googleApiKey, imageData);
    }
    
    console.log('Raw extracted text:', extractedText);
    
    // Parse the extracted text into structured data
    return await parseExtractedText(extractedText);
    
  } catch (error) {
    console.error('Vision OCR failed:', error);
    throw new Error(`Image processing failed: ${error.message}`);
  }
}

async function performVisionOCR(apiKey: string, imageData: string): Promise<string> {
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: imageData },
          features: [
            { type: 'TEXT_DETECTION', maxResults: 10 },
            { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 5 }
          ]
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
  } else if (data.responses?.[0]?.textAnnotations?.[0]?.description) {
    extractedText = data.responses[0].textAnnotations[0].description;
  }
  
  return extractedText || '';
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
              type: 'DOCUMENT_TEXT_DETECTION', 
              maxResults: 10,
            }
          ],
          imageContext: {
            textDetectionParams: {
              enableTextDetectionConfidenceScore: true
            }
          }
        }]
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Enhanced Vision API failed: ${response.status}`);
  }

  const data = await response.json();
  return data.responses?.[0]?.fullTextAnnotation?.text || '';
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

Rules:
- Look for player names, years (1950-2025), set names, card numbers, grades (PSA/BGS)
- Handle common OCR errors (0/O, 1/I/l, 5/S, etc.)
- Infer sport from context clues
- If uncertain, mark confidence as lower
- Return ONLY valid JSON

Required JSON format:
{
  "player": "Player Name",
  "year": "YYYY",
  "set": "Set Name",
  "cardNumber": "Card Number",
  "grade": "PSA 10" or "BGS 9.5" or null,
  "sport": "basketball|football|baseball|hockey|soccer|other",
  "confidence": 0.0-1.0,
  "rawText": "cleaned OCR text"
}`
        },
        {
          role: 'user',
          content: `Parse this trading card OCR text:\n\n${rawText}`
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

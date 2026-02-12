import { OPENAI_API_URL, OPENAI_MODEL } from './config.js';
import { getApiKey } from './setup.js';

// AIDEV-NOTE: The system prompt instructs the model to return a strict JSON
// object whose keys match the Firestore schema. Values are normalized to
// imperial units. Null is used for fields not visible in the photo.

const SYSTEM_PROMPT = `You are a workout data extractor. The user will send a photo of a cardio machine's display screen (treadmill, elliptical, bike, stair climber, etc.).

Extract the workout summary and return ONLY a JSON object with these exact keys:

{
  "elapsedTimeSeconds": <number — total workout duration in seconds>,
  "calories": <number — total calories burned>,
  "distanceMiles": <number — distance in miles (convert from km if needed)>,
  "distanceClimbedFeet": <number | null — vertical climb in feet (convert from meters if needed)>,
  "avgSpeedMph": <number — average speed in mph (convert from km/h if needed)>,
  "avgPaceSecondsPerMile": <number | null — average pace in seconds per mile>,
  "avgHeartRate": <number | null — average heart rate in BPM>
}

Rules:
- Return ONLY valid JSON, no markdown, no explanation.
- Use null for any field you cannot read from the photo.
- Convert metric units to imperial (km → miles, km/h → mph, meters → feet).
- For elapsed time, convert "MM:SS" or "H:MM:SS" format into total seconds.
- For pace like "8:51 / Mile", convert to total seconds (8*60 + 51 = 531).`;

/**
 * Send a workout photo to the OpenAI Vision API and return the extracted data.
 * @param {string} imageDataURL - base64 data URL of the photo
 * @returns {Promise<object>} Parsed workout fields
 */
export async function extractWorkoutFromImage(imageDataURL) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('OpenAI API key not configured');
    }

    const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: { url: imageDataURL },
                        },
                        {
                            type: 'text',
                            text: 'Extract the workout data from this cardio machine screen.',
                        },
                    ],
                },
            ],
            max_completion_tokens: 500,
            temperature: 0,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${body}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
        throw new Error('No content returned from OpenAI');
    }

    return parseExtraction(raw);
}

/**
 * Parse the LLM's JSON response, stripping any markdown fences if present.
 */
function parseExtraction(raw) {
    let cleaned = raw.trim();
    // Strip markdown code fences that models sometimes add
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }

    try {
        const parsed = JSON.parse(cleaned);
        validateExtraction(parsed);
        return parsed;
    } catch (err) {
        throw new Error(`Failed to parse LLM response: ${err.message}\nRaw: ${raw}`);
    }
}

const REQUIRED_FIELDS = ['elapsedTimeSeconds', 'calories', 'distanceMiles'];

function validateExtraction(data) {
    for (const field of REQUIRED_FIELDS) {
        if (data[field] == null) {
            throw new Error(`LLM did not extract required field: ${field}`);
        }
    }
}

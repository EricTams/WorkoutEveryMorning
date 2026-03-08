import { OPENAI_API_URL, OPENAI_MODEL } from './config.js';
import { getApiKey } from './setup.js';
import { resolveMachineType } from './machineType.js';

// AIDEV-NOTE: The system prompt instructs the model to return a strict JSON
// object whose keys match the Firestore schema. Values are normalized to
// imperial units. Null is used for fields not visible in the photo.

const SYSTEM_PROMPT = `You are a workout data extractor. The user will send a photo of a cardio machine's display screen (treadmill, elliptical, bike, stair climber, etc.).

Extract the workout summary and return ONLY a JSON object with these exact keys:

{
  "machineType": <string — best guess: "eliptical" | "treadmill" | "cycle" | "hiking">,
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
- For machineType, return your best guess as one of: "eliptical", "treadmill", "cycle", "hiking".
- Convert metric units to imperial (km → miles, km/h → mph, meters → feet).
- For elapsed time, convert "MM:SS" or "H:MM:SS" format into total seconds.
- For pace like "8:51 / Mile", convert to total seconds (8*60 + 51 = 531).`;

const HEALTH_SYSTEM_PROMPT = `You are a health measurement extractor. The user will send a photo of a handwritten or printed body-measurement sheet.

Return ONLY valid JSON with this exact shape:
{
  "items": [
    {
      "name": "<string metric label from sheet>",
      "value": <number>,
      "unit": "<string unit or empty string>",
      "confidence": <number 0..1>
    }
  ]
}

Rules:
- Return JSON only, no markdown.
- Include only measurable numeric values.
- Keep original metric naming from the sheet when possible.
- Parse fractional values (e.g. 12 1/2) into decimal numbers.
- If uncertain, still include the item with lower confidence.
- Omit non-measurement text.`;

const HEALTH_MATCH_SYSTEM_PROMPT = `You match extracted health measurements to an existing tracked stats list.

Return ONLY valid JSON with this exact shape:
{
  "matches": [
    {
      "index": <number>,
      "status": "<exact|close|new>",
      "selectedKey": "<string>",
      "suggestedKey": "<string>",
      "confidence": <number 0..1>
    }
  ]
}

Rules:
- "index" must reference the extracted item index provided by the user.
- If status is "exact" or "close", selectedKey MUST be one of the existing tracked stats.
- If status is "new", suggestedKey should be a concise human-readable metric name.
- Keep keys human readable (no snake_case conversion).
- Return JSON only.`;
const VISION_MAX_COMPLETION_TOKENS = 1600;
const TEXT_MAX_COMPLETION_TOKENS = 800;

/**
 * Send a workout photo to the OpenAI Vision API and return the extracted data.
 * @param {string} imageDataURL - base64 data URL of the photo
 * @returns {Promise<object>} Parsed workout fields
 */
export async function extractWorkoutFromImage(imageDataURL) {
    const raw = await requestVisionExtraction(
        SYSTEM_PROMPT,
        imageDataURL,
        'Extract the workout data from this cardio machine screen.',
    );
    return parseExtraction(raw);
}

/**
 * Send a health-sheet photo to the OpenAI Vision API and return extracted items.
 * @param {string} imageDataURL
 * @param {string[]} knownMetrics
 * @returns {Promise<Array<{name: string, value: number, unit: string, confidence: number}>>}
 */
export async function extractHealthFromImage(imageDataURL, knownMetrics = []) {
    const knownList = knownMetrics.length
        ? `Known metric keys: ${knownMetrics.join(', ')}`
        : 'Known metric keys: none yet';
    const prompt = `${knownList}. Extract all measurable values from this sheet.`;
    const raw = await requestVisionExtraction(HEALTH_SYSTEM_PROMPT, imageDataURL, prompt);
    const parsed = parseHealthExtraction(raw);
    return parsed.items;
}

/**
 * Match extracted health items to existing tracked stats using the LLM.
 * @param {Array<{name: string, value: number, unit: string, confidence: number}>} items
 * @param {string[]} trackedMetrics
 * @returns {Promise<Array>}
 */
export async function matchHealthMetrics(items, trackedMetrics = []) {
    const indexedItems = (Array.isArray(items) ? items : []).map((item, index) => ({
        index,
        name: String(item.name || '').trim(),
        value: Number(item.value),
        unit: String(item.unit || '').trim(),
        confidence: normalizeConfidence(item.confidence),
    }));
    const compactItems = indexedItems.map((item) => ({
        i: item.index,
        n: item.name,
        v: item.value,
        u: item.unit,
    }));
    const prompt = [
        `Tracked metrics: ${JSON.stringify(trackedMetrics)}`,
        `Extracted items: ${JSON.stringify(compactItems)}`,
        'Match each extracted item to tracked metrics or suggest a new metric key.',
    ].join('\n');
    const raw = await requestTextExtraction(HEALTH_MATCH_SYSTEM_PROMPT, prompt, {
        retryPrompt: `${prompt}\nReturn the smallest valid JSON possible. No extra fields.`,
    });
    return parseHealthMatches(raw, indexedItems, trackedMetrics);
}

async function requestVisionExtraction(systemPrompt, imageDataURL, userPrompt) {
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
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: { url: imageDataURL },
                        },
                        {
                            type: 'text',
                            text: userPrompt,
                        },
                    ],
                },
            ],
            max_completion_tokens: VISION_MAX_COMPLETION_TOKENS,
            temperature: 0,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${body}`);
    }

    const data = await response.json();
    const raw = extractMessageContent(data);
    if (!raw) {
        // A long sheet can exceed token budget; retry once with compactness instruction.
        if (isLengthLimited(data)) {
            const retryRaw = await requestVisionExtractionRetry(systemPrompt, imageDataURL, userPrompt);
            if (retryRaw) return retryRaw;
        }
        throw new Error(`No content returned from OpenAI. ${summarizeChoice(data)}`);
    }

    return raw;
}

async function requestVisionExtractionRetry(systemPrompt, imageDataURL, userPrompt) {
    const apiKey = getApiKey();
    if (!apiKey) return '';

    const compactPrompt = `${userPrompt}\nReturn compact JSON only. Keep keys short and avoid extra whitespace.`;
    const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: imageDataURL } },
                        { type: 'text', text: compactPrompt },
                    ],
                },
            ],
            max_completion_tokens: VISION_MAX_COMPLETION_TOKENS,
            temperature: 0,
        }),
    });
    if (!response.ok) return '';

    const data = await response.json();
    return extractMessageContent(data);
}

async function requestTextExtraction(systemPrompt, userPrompt, options = {}) {
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
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            max_completion_tokens: TEXT_MAX_COMPLETION_TOKENS,
            temperature: 0,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${body}`);
    }

    const data = await response.json();
    const raw = extractMessageContent(data);
    if (!raw) {
        if (isLengthLimited(data) && options.retryPrompt) {
            const retryRaw = await requestTextRetry(systemPrompt, options.retryPrompt);
            if (retryRaw) return retryRaw;
        }
        throw new Error(`No content returned from OpenAI. ${summarizeChoice(data)}`);
    }
    return raw;
}

async function requestTextRetry(systemPrompt, userPrompt) {
    const apiKey = getApiKey();
    if (!apiKey) return '';
    const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            max_completion_tokens: TEXT_MAX_COMPLETION_TOKENS,
            temperature: 0,
        }),
    });
    if (!response.ok) return '';
    const data = await response.json();
    return extractMessageContent(data);
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
        parsed.machineType = resolveMachineType(parsed);
        validateExtraction(parsed);
        return parsed;
    } catch (err) {
        throw new Error(`Failed to parse LLM response: ${err.message}\nRaw: ${raw}`);
    }
}

function parseHealthExtraction(raw) {
    const parsed = parseJsonResponse(raw);
    if (!parsed || !Array.isArray(parsed.items)) {
        throw new Error('LLM did not return a valid health extraction payload');
    }
    const items = parsed.items
        .map((item) => normalizeHealthItem(item))
        .filter(Boolean);
    return { items };
}

function parseHealthMatches(raw, indexedItems, trackedMetrics) {
    const parsed = parseJsonResponse(raw);
    if (!parsed || !Array.isArray(parsed.matches)) {
        throw new Error('LLM did not return a valid health matching payload');
    }

    const byIndex = new Map();
    for (const match of parsed.matches) {
        const index = Number(match?.index);
        if (Number.isNaN(index)) continue;
        byIndex.set(index, match);
    }

    return indexedItems.map((item) => {
        const matched = byIndex.get(item.index);
        if (!matched) {
            return fallbackNewMatch(item, trackedMetrics);
        }

        const status = normalizeStatus(matched.status);
        const selectedKey = normalizeKey(matched.selectedKey);
        const suggestedKey = normalizeKey(matched.suggestedKey);
        const confidence = normalizeConfidence(matched.confidence);
        if (status === 'exact' || status === 'close') {
            const existing = findTrackedMetric(selectedKey, trackedMetrics);
            if (!existing) {
                return fallbackNewMatch(item, trackedMetrics);
            }
            return {
                status,
                name: item.name,
                value: item.value,
                unit: item.unit,
                confidence,
                selectedKey: existing,
                suggestedKey: existing,
                knownOptions: trackedMetrics,
            };
        }

        const nextKey = suggestedKey || selectedKey || item.name;
        return {
            status: 'new',
            name: item.name,
            value: item.value,
            unit: item.unit,
            confidence,
            selectedKey: normalizeKey(nextKey),
            suggestedKey: normalizeKey(nextKey),
            knownOptions: trackedMetrics,
        };
    });
}

const REQUIRED_FIELDS = ['elapsedTimeSeconds', 'calories', 'distanceMiles'];

function validateExtraction(data) {
    for (const field of REQUIRED_FIELDS) {
        if (data[field] == null) {
            throw new Error(`LLM did not extract required field: ${field}`);
        }
    }
}

function parseJsonResponse(raw) {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }
    try {
        return JSON.parse(cleaned);
    } catch (err) {
        throw new Error(`Failed to parse LLM response: ${err.message}\nRaw: ${raw}`);
    }
}

function normalizeHealthItem(item) {
    if (!item || typeof item !== 'object') return null;
    const name = String(item.name || '').trim();
    if (!name) return null;
    const value = Number(item.value);
    if (Number.isNaN(value)) return null;
    const unit = String(item.unit || '').trim();
    const confidence = normalizeConfidence(item.confidence);
    return { name, value, unit, confidence };
}

function normalizeConfidence(rawConfidence) {
    const num = Number(rawConfidence);
    if (Number.isNaN(num)) return 0.5;
    if (num < 0) return 0;
    if (num > 1) return 1;
    return num;
}

function normalizeStatus(rawStatus) {
    if (rawStatus === 'exact') return 'exact';
    if (rawStatus === 'close') return 'close';
    return 'new';
}

function normalizeKey(rawName) {
    return String(rawName || '')
        .trim()
        .replace(/\s+/g, ' ');
}

function findTrackedMetric(candidate, trackedMetrics) {
    const target = normalizeKey(candidate).toLowerCase();
    if (!target) return '';
    for (const metric of trackedMetrics || []) {
        const key = normalizeKey(metric);
        if (key.toLowerCase() === target) return key;
    }
    return '';
}

function fallbackNewMatch(item, trackedMetrics) {
    const fallbackKey = normalizeKey(item.name);
    return {
        status: 'new',
        name: item.name,
        value: item.value,
        unit: item.unit,
        confidence: item.confidence ?? 0.5,
        selectedKey: fallbackKey,
        suggestedKey: fallbackKey,
        knownOptions: trackedMetrics,
    };
}

function extractMessageContent(data) {
    const msg = data?.choices?.[0]?.message;
    if (!msg) return '';
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        const textParts = msg.content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part?.type === 'text') return part.text || '';
                return '';
            })
            .filter(Boolean);
        return textParts.join('\n').trim();
    }
    return '';
}

function summarizeChoice(data) {
    const choice = data?.choices?.[0];
    const finishReason = choice?.finish_reason ? `finish_reason=${choice.finish_reason}` : 'finish_reason=unknown';
    const refusal = choice?.message?.refusal ? `refusal=${choice.message.refusal}` : '';
    return [finishReason, refusal].filter(Boolean).join(', ');
}

function isLengthLimited(data) {
    return String(data?.choices?.[0]?.finish_reason || '').toLowerCase() === 'length';
}

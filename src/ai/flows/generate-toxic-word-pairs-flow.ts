'use server';
/**
 * @fileOverview A Genkit flow for generating challenging and creative 'undercover' word pairs.
 *
 * - generateToxicWordPairs - A function that handles the generation of toxic word pairs.
 * - GenerateToxicWordPairsInput - The input type for the generateToxicWordPairs function.
 * - GenerateToxicWordPairsOutput - The return type for the generateToxicWordPairs function.
 */

import { z } from 'zod';

const GenerateToxicWordPairsInputSchema = z
  .object({
    theme: z
      .string()
      .optional()
      .describe(
        'An optional theme or category for the word pairs. e.g., "animals", "food", "technology".'
      ),
  })
  .describe('Input for generating a pair of toxic words.');
export type GenerateToxicWordPairsInput = z.infer<
  typeof GenerateToxicWordPairsInputSchema
>;

const GenerateToxicWordPairsOutputSchema = z
  .object({
    civilianWord: z
      .string()
      .describe(
        'The word assigned to the civilian player, which is related to but distinct from the undercover word.'
      ),
    undercoverWord: z
      .string()
      .describe(
        'The word assigned to the undercover player, which is similar to the civilian word but has subtle differences.'
      ),
  })
  .describe('A generated pair of toxic words for the Undercover game.');
export type GenerateToxicWordPairsOutput = z.infer<
  typeof GenerateToxicWordPairsOutputSchema
>;

const DeepseekWordPairsResponseSchema = z.object({
  pairs: z
    .array(GenerateToxicWordPairsOutputSchema)
    .min(1)
    .max(10)
    .describe('A list of candidate word pairs to choose from.'),
});

type DeepseekWordPairsResponse = z.infer<typeof DeepseekWordPairsResponseSchema>;

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

async function callDeepseekForToxicWordPairs(
  input: GenerateToxicWordPairsInput
): Promise<GenerateToxicWordPairsOutput> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error(
      'DEEPSEEK_API_KEY is not set. Please add it to your environment variables.'
    );
  }

  const parsedInput = GenerateToxicWordPairsInputSchema.parse(input);

  const fallbackThemes = [
    'food',
    'animals',
    'jobs',
    'sports',
    'school',
    'travel',
    'technology',
    'music',
    'movies',
    'household items',
  ] as const;

  const effectiveTheme =
    parsedInput.theme ??
    fallbackThemes[Math.floor(Math.random() * fallbackThemes.length)];

  const systemPrompt =
    "You are an expert at generating challenging and creative word pairs for the game 'Who is the Undercover Agent?'. " +
    "Your task is to generate two words that are closely related but distinct enough to cause confusion and discussion among players. " +
    "One word will be for the 'civilian' and the other for the 'undercover' agent. " +
    "The words should be common enough to be describable but tricky to differentiate without knowing the other word. " +
    "Aim for a 'toxic' feel, meaning they should provoke thought and potentially mislead players. " +
    'Always respond strictly as a JSON object matching the specified schema. ' +
    'Avoid repeating the exact same words across different pairs; ensure variety within the chosen theme.';

  const themeInstruction = effectiveTheme
    ? `Generate several different pairs of words related to the theme: "${effectiveTheme}". Try to cover different sub-areas of this theme.`
    : 'Generate several general pairs of words.';

  const userPrompt = [
    'Generate 5 different word pairs for the Undercover game.',
    'Example:',
    'Civilian: Chair',
    'Undercover: Stool',
    '',
    'Example:',
    'Civilian: Ocean',
    'Undercover: Sea',
    '',
    themeInstruction,
    '',
    'Return only JSON with the following shape:',
    '{ "pairs": [ { "civilianWord": string, "undercoverWord": string }, ... ] }',
  ].join('\n');

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `DeepSeek API request failed with status ${response.status}: ${errorText}`
    );
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };

  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('DeepSeek API returned an empty response.');
  }

  let parsedOutput: unknown;

  if (typeof content === 'string') {
    parsedOutput = JSON.parse(content);
  } else {
    parsedOutput = content;
  }

  // Prefer the new multi-pair format; fall back to single pair if needed
  const multiResult = DeepseekWordPairsResponseSchema.safeParse(parsedOutput);
  if (multiResult.success) {
    const pairs = multiResult.data.pairs;
    const randomIndex = Math.floor(Math.random() * pairs.length);
    return pairs[randomIndex];
  }

  // Backward compatibility in case the model returns a single pair
  return GenerateToxicWordPairsOutputSchema.parse(parsedOutput);
}

export async function generateToxicWordPairs(
  input: GenerateToxicWordPairsInput
): Promise<GenerateToxicWordPairsOutput> {
  return callDeepseekForToxicWordPairs(input);
}

'use server';
/**
 * @fileOverview A Genkit flow for generating challenging and creative 'undercover' word pairs.
 *
 * - generateToxicWordPairs - A function that handles the generation of toxic word pairs.
 * - GenerateToxicWordPairsInput - The input type for the generateToxicWordPairs function.
 * - GenerateToxicWordPairsOutput - The return type for the generateToxicWordPairs function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

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

export async function generateToxicWordPairs(
  input: GenerateToxicWordPairsInput
): Promise<GenerateToxicWordPairsOutput> {
  return generateToxicWordPairsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateToxicWordPairsPrompt',
  input: { schema: GenerateToxicWordPairsInputSchema },
  output: { schema: GenerateToxicWordPairsOutputSchema },
  prompt: `You are an expert at generating challenging and creative word pairs for the game 'Who is the Undercover Agent?'.
Your task is to generate two words that are closely related but distinct enough to cause confusion and discussion among players. One word will be for the 'civilian' and the other for the 'undercover' agent.

Instructions:
- Generate a pair of words that are subtly different but easily confusable in a game context.
- The words should be common enough to be describable but tricky to differentiate without knowing the other word.
- Aim for a 'toxic' feel, meaning they should provoke thought and potentially mislead players.
- If a theme is provided, try to adhere to it.

Example:
Civilian: Chair
Undercover: Stool

Example:
Civilian: Ocean
Undercover: Sea

{{#if theme}}
Generate a pair of words related to the theme: {{{theme}}}.
{{else}}
Generate a general pair of words.
{{/if}}

Output the result in JSON format as specified by the output schema.`,
});

const generateToxicWordPairsFlow = ai.defineFlow(
  {
    name: 'generateToxicWordPairsFlow',
    inputSchema: GenerateToxicWordPairsInputSchema,
    outputSchema: GenerateToxicWordPairsOutputSchema,
  },
  async (input) => {
    const { output } = await ai.generate({
      model: 'googleai/gemini-1.5-pro',
      prompt: prompt.render(input),
    });
    return output!;
  }
);

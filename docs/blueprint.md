# **App Name**: DeepSpy Bot

## Core Features:

- Telegram Webhook API: Establish a webhook endpoint to receive and process updates from the Telegram bot, acting as the primary interface for game interaction.
- Game State & Player Management: Manage ongoing game states (waiting, word distribution, description, voting) and persist player data, roles, and assigned words for each active game session.
- Player Waiting Room & Join Logic: Allow users to join a game instance and indicate their readiness, with bot notifications for status updates.
- Undercover Word Assignment & Distribution: Distribute unique 'undercover' and 'civilian' words privately to players, facilitating the core game mechanism.
- DeepSeek Toxic Word Pair Generator Tool: A frontend interface to generate challenging and creative 'undercover' word pairs using the DeepSeek generative AI model. This tool provides suggested pairs suitable for engaging gameplay.
- Player Description Submission & Collection: Enable players to submit text descriptions related to their assigned word, which can then be shared with other players.
- Voting Mechanism & Outcome Declaration: Implement a system for players to cast votes for suspected undercover agents, and automatically declare the game's outcome based on the votes.

## Style Guidelines:

- Primary color: Electric Purple (#841CFF) to convey a vibrant, futuristic, and mysterious atmosphere, ideal for highlights and interactive elements.
- Background color: Dark Desaturated Purple (#17141A) provides a deep, immersive canvas that enhances the electric primary and accent colors, fitting the 'cyber' theme.
- Accent color: Neon Magenta (#E51AFF) used sparingly for critical calls to action, warnings, or distinctive 'toxic' elements to provide stark contrast and visual pop.
- Headline and Body text font: 'Space Grotesk' (sans-serif) for its modern, techy, and slightly condensed appearance, which complements the cyber aesthetic. Suitable for both headers and the concise text found in bot interactions and generator outputs.
- Employ minimalist, geometric line icons with an optional 'glitch' effect on hover or interaction to reinforce the digital, cyberpunk theme. Icons should clearly communicate bot commands and game actions.
- Feature a dark, clean layout with ample spacing and neon highlights to draw attention to critical information and actions. Elements should appear crisp and well-defined, aligning with a sophisticated, digital interface.
- Incorporate subtle, responsive hover effects with a soft glow, and delicate transition animations when switching between game states or revealing new information. Glitch-like effects can be used selectively for high-impact moments, such as successful undercover detection or critical alerts.
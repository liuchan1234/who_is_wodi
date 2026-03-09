import { NextResponse } from 'next/server';
import { generateToxicWordPairs } from '@/ai/flows/generate-toxic-word-pairs-flow';

// Basic types for Telegram Bot API
interface User {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface Chat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
}

interface Message {
  message_id: number;
  from?: User;
  chat: Chat;
  date: number;
  text?: string;
}

interface Update {
  update_id: number;
  message?: Message;
  // Other update types like callback_query can be added here
}

// Game-specific types
type GameState = 'waiting' | 'words_distributed' | 'describing' | 'voting' | 'finished';

interface Player {
  id: number;
  username: string;
  isReady: boolean;
  role: 'civilian' | 'undercover' | 'undecided';
  word: string;
  description?: string;
  votedFor?: number;
}

interface Game {
  chatId: number;
  state: GameState;
  players: Map<number, Player>;
  words: {
    civilianWord: string;
    undercoverWord: string;
  };
  undercoverPlayerId?: number;
}


// In-memory store for game sessions. Replace with a database in production.
const games = new Map<number, Game>();
const MIN_PLAYERS = 3; 

/**
 * Sends a message to a given Telegram chat.
 * @param chatId The ID of the chat to send the message to.
 * @param text The message text.
 * @param extra Any extra parameters for the Telegram API.
 */
async function sendMessage(chatId: number, text: string, extra: any = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set');
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra }),
    });
    if (!response.ok) {
      const errorBody = await response.json();
      console.error('Telegram API error:', errorBody);
    }
  } catch (error) {
    console.error('Failed to send message:', error);
  }
}

/**
 * Starts a new game round, generating words and assigning roles.
 * @param game The game object.
 */
async function startGame(game: Game) {
    await sendMessage(game.chatId, 'All players are ready! Generating words and assigning roles...');
    game.state = 'words_distributed';

    try {
        const wordPair = await generateToxicWordPairs({});
        game.words = wordPair;

        const players = Array.from(game.players.values());
        const undercoverIndex = Math.floor(Math.random() * players.length);
        const undercoverPlayer = players[undercoverIndex];
        game.undercoverPlayerId = undercoverPlayer.id;

        let dmFailed = false;
        for (const player of players) {
            if (player.id === undercoverPlayer.id) {
                player.role = 'undercover';
                player.word = game.words.undercoverWord;
            } else {
                player.role = 'civilian';
                player.word = game.words.civilianWord;
            }
            // Send DMs
            try {
                await sendMessage(player.id, `The game in chat "${game.chatId}" has started!\nYour word is: *${player.word}*`);
            } catch (dmError) {
                console.error(`Failed to DM player ${player.id}`, dmError);
                await sendMessage(game.chatId, `Could not send a private message to @${player.username}. Please make sure you have started a chat with the bot first! The game cannot start.`);
                dmFailed = true;
                break; 
            }
        }
        
        if (dmFailed) {
            games.delete(game.chatId);
            await sendMessage(game.chatId, 'Game cancelled because a player could not receive their word. Please make sure everyone has messaged the bot directly first.');
            return;
        }

        await sendMessage(game.chatId, '🤫 All words have been sent via private message. The first player should now describe their word without saying it. Let the spying begin!');

    } catch (error) {
        console.error('Failed to start game:', error);
        await sendMessage(game.chatId, 'Oops! The AI failed to generate words. The game has been cancelled. Please try again with /start.');
        games.delete(game.chatId);
    }
}

/**
 * Handles incoming webhook requests from Telegram.
 * @param {Request} request - The incoming request object.
 * @returns {NextResponse} A response object.
 */
export async function POST(request: Request) {
  try {
    const body: Update = await request.json();
    console.log('Received Telegram update:', JSON.stringify(body, null, 2));

    if (body.message && body.message.text && body.message.from && body.message.chat.type !== 'private') {
      const chatId = body.message.chat.id;
      const text = body.message.text;
      const from = body.message.from;
      const userId = from.id;
      const username = from.username || from.first_name;

      const game = games.get(chatId);

      // Command handling
      if (text.startsWith('/')) {
        const [command] = text.split(/ |@/);

        switch (command) {
          case '/start':
            if (game) {
              await sendMessage(chatId, 'A game is already in progress or waiting in this chat.');
            } else {
              const newGame: Game = {
                chatId,
                state: 'waiting',
                players: new Map(),
                words: { civilianWord: '', undercoverWord: '' },
              };
              games.set(chatId, newGame);
              await sendMessage(chatId, '🕵️ DeepSpy game created! Who wants to play?\nType /join to enter the game.');
            }
            break;

          case '/join':
            if (!game) {
              await sendMessage(chatId, 'No game is active. Type /start to create one.');
            } else if (game.state !== 'waiting') {
              await sendMessage(chatId, 'The game has already started. Wait for the next round!');
            } else if (game.players.has(userId)) {
              await sendMessage(chatId, `@${username}, you are already in the game.`);
            } else {
              const player: Player = { id: userId, username, isReady: false, role: 'undecided', word: '' };
              game.players.set(userId, player);
              await sendMessage(chatId, `@${username} has joined the game! We now have ${game.players.size} players.\n\nType /ready when you're set.`);
            }
            break;

          case '/ready':
            if (!game || !game.players.has(userId)) {
              await sendMessage(chatId, 'You are not in the game. Type /join to get in on the action.');
            } else if (game.state !== 'waiting') {
              await sendMessage(chatId, 'The game is not in the waiting phase.');
            } else {
              const player = game.players.get(userId)!;
              if (player.isReady) {
                await sendMessage(chatId, `@${username}, you are already marked as ready.`);
              } else {
                player.isReady = true;
                const allPlayers = Array.from(game.players.values());
                const readyCount = allPlayers.filter(p => p.isReady).length;
                await sendMessage(chatId, `@${username} is ready! (${readyCount}/${allPlayers.length} players are ready).`);

                const allReady = allPlayers.every(p => p.isReady);
                if (allPlayers.length >= MIN_PLAYERS && allReady) {
                  await startGame(game);
                } else if (allPlayers.length < MIN_PLAYERS && allReady) {
                  await sendMessage(chatId, `All players are ready, but we need at least ${MIN_PLAYERS} to start. Current: ${allPlayers.length}.`);
                }
              }
            }
            break;
          
          case '/status':
            if (!game) {
              await sendMessage(chatId, 'No game is active. Type /start to create one.');
            } else {
              const players = Array.from(game.players.values());
              const playerList = players.map(p => `@${p.username} (${p.isReady ? 'Ready' : 'Not Ready'})`).join('\n') || 'No players have joined.';
              await sendMessage(chatId, `*Game Status: ${game.state}*\n\n*Players (${players.length}):*\n${playerList}`);
            }
            break;
          
          case '/cancel':
            if (game) {
              games.delete(chatId);
              await sendMessage(chatId, 'The game has been cancelled.');
            } else {
              await sendMessage(chatId, 'There is no game to cancel.');
            }
            break;
            
          default:
            // Could add a help message here for unknown commands
            break;
        }
      }
    } else if (body.message?.chat.type === 'private') {
        // Handle private messages, e.g., for descriptions or votes
        await sendMessage(body.message.chat.id, "I've received your message. Game actions like describing your word and voting should happen here. This functionality is coming soon!");
    }

    // Acknowledge the update to Telegram.
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    // Avoid sending detailed errors back to Telegram for security.
    return NextResponse.json({ status: 'error', message: 'Internal Server Error' }, { status: 500 });
  }
}

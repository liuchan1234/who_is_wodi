import { NextResponse } from 'next/server';

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
type GameState = 'waiting' | 'words_distributed' | 'describing' | 'voting';

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


// In-memory store for game sessions. Replace with a database (e.g., Firestore, Redis) in production.
const games = new Map<number, Game>();

/**
 * Handles incoming webhook requests from Telegram.
 * @param {Request} request - The incoming request object.
 * @returns {NextResponse} A response object.
 */
export async function POST(request: Request) {
  try {
    const body: Update = await request.json();
    console.log('Received Telegram update:', JSON.stringify(body, null, 2));

    if (body.message) {
      const chatId = body.message.chat.id;
      const text = body.message.text;
      const from = body.message.from;

      // TODO: Implement game logic based on the update type and message content.
      // This is a simplified example.
      // e.g., if (text === '/start') { createGame(chatId) }
      // e.g., if (text === '/join' && from) { joinGame(chatId, from) }
      
      // The logic would involve:
      // 1. Parsing commands (/start, /join, /vote, etc.).
      // 2. Managing game state (waiting -> describing -> voting -> end).
      // 3. Interacting with the game state store (the `games` map in this case).
      // 4. Sending messages back to the user/group via the Telegram Bot API (e.g., using fetch).
    }

    // Acknowledge the update to Telegram.
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json({ status: 'error', message: 'Internal Server Error' }, { status: 500 });
  }
}

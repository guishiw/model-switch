import { z } from 'zod';

export const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.any())]).nullable(),
  name: z.string().optional(),
  tool_calls: z.array(z.any()).optional(),
  tool_call_id: z.string().optional(),
});

export const ChatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(MessageSchema).min(1),
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
  tools: z.array(z.any()).optional(),
  tool_choice: z.any().optional(),
  response_format: z.any().optional(),
  user: z.string().optional(),
  // gateway extension: attach to a session to auto-prepend context
  session_id: z.string().optional(),
}).passthrough();

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type ChatMessage = z.infer<typeof MessageSchema>;

export type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };

/** Normalized non-stream response (OpenAI shape) */
export type ChatCompletionResponse = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{ index: number; message: ChatMessage; finish_reason: string | null }>;
  usage: Usage;
};

/** Normalized stream chunk (OpenAI shape) */
export type ChatCompletionChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{ index: number; delta: Partial<ChatMessage>; finish_reason: string | null }>;
  usage?: Usage;
};

export type UpstreamTarget = {
  channelId: string;
  channelName: string;
  provider: 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'OLLAMA';
  baseUrl: string;
  apiKeyId: string;
  apiKey: string;
  upstreamModel: string;
  extraHeaders: Record<string, string>;
  config: Record<string, any>;
};

export class UpstreamError extends Error {
  constructor(public status: number, message: string, public retriable: boolean, public keyInvalid = false) {
    super(message);
  }
}

export interface Provider {
  /** Non-streaming call; must return OpenAI-shaped response */
  complete(target: UpstreamTarget, req: ChatCompletionRequest, signal: AbortSignal): Promise<ChatCompletionResponse>;
  /** Streaming call; yields OpenAI-shaped chunks; final chunk should carry `usage` when the upstream provides it */
  stream(target: UpstreamTarget, req: ChatCompletionRequest, signal: AbortSignal): AsyncGenerator<ChatCompletionChunk>;
}

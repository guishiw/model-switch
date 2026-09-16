import type { Provider, UpstreamTarget } from '../types';
import { openaiProvider } from './openai';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';

export function providerFor(type: UpstreamTarget['provider']): Provider {
  switch (type) {
    case 'ANTHROPIC': return anthropicProvider;
    case 'GEMINI': return geminiProvider;
    case 'OPENAI':
    case 'OLLAMA':
    default: return openaiProvider;
  }
}

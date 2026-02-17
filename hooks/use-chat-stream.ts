// Chat Stream Hook - Handles SSE streaming for chat
// Optimized with Vercel best practices

import { useState, useCallback, useRef, useMemo } from 'react';
import type { StreamChatEvent, Message } from '@/lib/types';

interface UseChatStreamOptions {
  onError?: (error: string) => void;
  onComplete?: (conversationId: string) => void;
}

interface UseChatStreamReturn {
  isLoading: boolean;
  conversationId: string | null;
  messages: Message[];
  streamingContent: string;
  error: string | null;
  sendMessage: (message: string, conversationId?: string) => Promise<void>;
  clearError: () => void;
  resetConversation: () => void;
}

// Stable callback refs pattern (advanced-event-handler-refs)
export function useChatStream(options: UseChatStreamOptions = {}): UseChatStreamReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Use ref for stable callback references (advanced-event-handler-refs)
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Memoize stable callbacks (rerender-functional-setstate)
  const sendMessage = useCallback(async (message: string, existingConversationId?: string) => {
    setIsLoading(loading => {
      if (loading) return loading; // Early exit if already loading
      return true;
    });

    setStreamingContent('');
    setError(null);

    // Add user message immediately with functional update
    const tempId = `temp-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: tempId,
      conversation_id: existingConversationId || '',
      role: 'user',
      content: message,
      metadata: {},
      created_at: new Date().toISOString(),
    }]);

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          conversation_id: existingConversationId || conversationId,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send message');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response stream');
      }

      const decoder = new TextDecoder();
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: StreamChatEvent = JSON.parse(line.slice(6));

              switch (event.type) {
                case 'conversation_id':
                  if (event.conversation_id) {
                    setConversationId(event.conversation_id);
                    // Functional update for stable references
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === tempId
                          ? { ...m, conversation_id: event.conversation_id! }
                          : m
                      )
                    );
                  }
                  break;

                case 'content':
                  if (event.content) {
                    assistantContent += event.content;
                    setStreamingContent(assistantContent);
                  }
                  break;

                case 'error':
                  setError(event.error || 'An error occurred');
                  optionsRef.current.onError?.(event.error || 'An error occurred');
                  break;

                case 'done': {
                  // Add assistant message with functional update
                  const newConversationId = event.conversation_id;
                  setMessages(prev => [...prev, {
                    id: `msg-${Date.now()}`,
                    conversation_id: newConversationId || conversationId || '',
                    role: 'assistant',
                    content: assistantContent,
                    metadata: {},
                    created_at: new Date().toISOString(),
                  }]);
                  setStreamingContent('');

                  if (newConversationId || conversationId) {
                    optionsRef.current.onComplete?.(newConversationId || conversationId!);
                  }
                  break;
                }
              }
            } catch {
              // Ignore parse errors for incomplete JSON
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMessage);
      optionsRef.current.onError?.(errorMessage);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [conversationId]); // Minimal dependencies

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const resetConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setStreamingContent('');
    setError(null);
  }, []);

  return useMemo(() => ({
    isLoading,
    conversationId,
    messages,
    streamingContent,
    error,
    sendMessage,
    clearError,
    resetConversation,
  }), [
    isLoading,
    conversationId,
    messages,
    streamingContent,
    error,
    sendMessage,
    clearError,
    resetConversation,
  ]);
}

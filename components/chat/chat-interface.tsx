// Chat Interface Component
// Optimized with Vercel best practices, UI/UX Pro Max & Responsive Design guidelines

'use client';

import { useState, useRef, useEffect, memo, useMemo, useCallback } from 'react';
import { useChatStream } from '@/hooks/use-chat-stream';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Trash2, Loader2, Bot, User, AlertCircle, X, Sparkles } from 'lucide-react';
import type { Message } from '@/lib/types';

// Hoist regex outside component (js-hoist-regexp)
const CODE_BLOCK_REGEX = /(```[\s\S]*?```)/g;
const INLINE_CODE_REGEX = /(`[^`]+`)/g;
const BOLD_REGEX = /(\*\*[^*]+\*\*)/g;

// Memoized MessageBubble (rerender-memo)
const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming = false,
}: {
  message: Message;
  isStreaming?: boolean;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-2 sm:gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar - Responsive sizing */}
      <div
        className={`flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-colors duration-200 ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        }`}
        aria-hidden="true"
      >
        {isUser ? <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
      </div>

      {/* Message content - Responsive max-width and padding */}
      <div
        className={`flex-1 max-w-[88%] sm:max-w-[85%] md:max-w-[80%] rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 transition-all duration-200 ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm sm:rounded-tr-md'
            : 'bg-muted rounded-tl-sm sm:rounded-tl-md'
        }`}
      >
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <MessageContent content={message.content || ''} />
          {isStreaming && (
            <span className="inline-block w-1.5 h-3 sm:w-2 sm:h-4 bg-current animate-pulse ml-1 rounded-full" />
          )}
        </div>
      </div>
    </div>
  );
});

// Memoized MessageContent (rerender-memo)
const MessageContent = memo(function MessageContent({ content }: { content: string }) {
  const parts = useMemo(() => content.split(CODE_BLOCK_REGEX), [content]);

  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed text-sm sm:text-base">
      {parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const lines = part.slice(3, -3).split('\n');
          const language = lines[0] || '';
          const code = lines.slice(1).join('\n');

          return (
            <pre
              key={index}
              className="bg-black/10 dark:bg-black/30 rounded-md sm:rounded-lg p-2 sm:p-3 my-1.5 sm:my-2 overflow-x-auto text-[10px] sm:text-xs border border-border/50 -mx-1 sm:mx-0"
            >
              {language && (
                <div className="text-[10px] sm:text-xs text-muted-foreground mb-1.5 sm:mb-2 font-medium uppercase tracking-wide">
                  {language}
                </div>
              )}
              <code className="font-mono">{code || part.slice(3, -3)}</code>
            </pre>
          );
        }

        return <InlineContent key={index} part={part} />;
      })}
    </div>
  );
});

// Separate component for inline content parsing
const InlineContent = memo(function InlineContent({ part }: { part: string }) {
  const inlineParts = useMemo(() => part.split(INLINE_CODE_REGEX), [part]);

  return (
    <span>
      {inlineParts.map((inlinePart, inlineIndex) => {
        if (inlinePart.startsWith('`') && inlinePart.endsWith('`')) {
          return (
            <code
              key={inlineIndex}
              className="bg-black/10 dark:bg-black/30 px-1 sm:px-1.5 py-0.5 rounded text-xs sm:text-sm font-mono border border-border/30"
            >
              {inlinePart.slice(1, -1)}
            </code>
          );
        }

        return <BoldContent key={inlineIndex} part={inlinePart} />;
      })}
    </span>
  );
});

// Separate component for bold content parsing
const BoldContent = memo(function BoldContent({ part }: { part: string }) {
  const boldParts = useMemo(() => part.split(BOLD_REGEX), [part]);

  return (
    <>
      {boldParts.map((boldPart, boldIndex) => {
        if (boldPart.startsWith('**') && boldPart.endsWith('**')) {
          return (
            <strong key={boldIndex} className="font-semibold">
              {boldPart.slice(2, -2)}
            </strong>
          );
        }
        return <span key={boldIndex}>{boldPart}</span>;
      })}
    </>
  );
});

// Welcome screen - Mobile optimized
const WelcomeContent = (
  <div className="flex flex-col items-center justify-center text-center py-8 sm:py-12 px-3 sm:px-4">
    <div className="relative mb-4 sm:mb-6">
      <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-xl sm:rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
        <Sparkles className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 text-primary-foreground" />
      </div>
      <div className="absolute -inset-1.5 sm:-inset-2 bg-primary/10 rounded-2xl sm:rounded-3xl blur-xl -z-10" />
    </div>
    <h2 className="text-lg sm:text-xl font-semibold mb-1.5 sm:mb-2">Welcome to ElonsBot</h2>
    <p className="text-xs sm:text-sm text-muted-foreground max-w-xs sm:max-w-md leading-relaxed">
      Your AI assistant with web search, Python & memory.
      <span className="block mt-1.5 sm:mt-2 text-[10px] sm:text-xs">Try: "Search the web" or "Write Python code"</span>
    </p>
  </div>
);

export function ChatInterface() {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    isLoading,
    conversationId,
    messages,
    streamingContent,
    error,
    sendMessage,
    clearError,
    resetConversation,
  } = useChatStream({
    onError: (err) => console.error('Chat error:', err),
  });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Focus input on mount (desktop only to avoid mobile keyboard popup)
  useEffect(() => {
    // Only auto-focus on larger screens
    if (window.innerWidth >= 640) {
      inputRef.current?.focus();
    }
  }, []);

  // Stable callback handlers
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedInput = input.trim();
    if (!trimmedInput || isLoading) return;

    setInput('');
    await sendMessage(trimmedInput, conversationId || undefined);
  }, [input, isLoading, sendMessage, conversationId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }, [handleSubmit]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  }, []);

  // Memoize streaming message
  const streamingMessage = useMemo(() => {
    if (!streamingContent) return null;
    return {
      id: 'streaming',
      conversation_id: conversationId || '',
      role: 'assistant' as const,
      content: streamingContent,
      metadata: {},
      created_at: new Date().toISOString(),
    };
  }, [streamingContent, conversationId]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-gradient-to-b from-background to-muted/20">
      {/* Header - Mobile optimized */}
      <header className="flex items-center justify-between p-3 sm:p-4 border-b bg-background/80 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
            <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-xs sm:text-sm">ElonsBot</h2>
            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
              {conversationId ? `Chat ${conversationId.slice(0, 6)}` : 'New chat'}
            </p>
          </div>
        </div>

        {/* Reset button - Touch target 44px on mobile */}
        <Button
          variant="ghost"
          size="icon"
          onClick={resetConversation}
          aria-label="Start new conversation"
          title="New conversation"
          className="h-10 w-10 sm:h-11 sm:w-11 cursor-pointer transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive active:scale-95 flex-shrink-0"
        >
          <Trash2 className="h-4 w-4 sm:h-4.5 sm:w-4.5" />
        </Button>
      </header>

      {/* Messages Area - Mobile optimized */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 scroll-smooth overscroll-contain">
        {messages.length === 0 && !streamingContent && WelcomeContent}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {streamingMessage && (
          <MessageBubble message={streamingMessage} isStreaming />
        )}

        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

      {/* Error Display - Mobile optimized */}
      {error ? (
        <div
          className="mx-3 sm:mx-4 mb-2 px-3 sm:px-4 py-2.5 sm:py-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-xs sm:text-sm flex items-center gap-2 sm:gap-3 animate-in slide-in-from-bottom-2 duration-200 flex-shrink-0"
          role="alert"
        >
          <AlertCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
          <span className="flex-1 text-xs sm:text-base">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearError}
            aria-label="Dismiss error"
            className="h-8 w-8 sm:h-9 sm:w-9 p-0 cursor-pointer hover:bg-destructive/20 active:scale-95 flex-shrink-0"
          >
            <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </Button>
        </div>
      ) : null}

      {/* Input Area - Mobile optimized with safe area */}
      <form
        onSubmit={handleSubmit}
        className="p-3 sm:p-4 border-t bg-background/80 backdrop-blur-sm flex-shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex gap-2 max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <Input
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={isLoading}
              aria-label="Message input"
              // 16px minimum font size for iOS to prevent zoom
              className="h-11 sm:h-12 pr-4 text-base rounded-xl sm:rounded-xl border-input focus-visible:ring-2 transition-all duration-200"
            />
          </div>

          {/* Send button - Touch target 44px minimum */}
          <Button
            type="submit"
            disabled={isLoading || !input.trim()}
            aria-label={isLoading ? 'Sending message' : 'Send message'}
            className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl cursor-pointer transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:hover:scale-100 flex-shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
            ) : (
              <Send className="h-4 w-4 sm:h-5 sm:w-5" />
            )}
          </Button>
        </div>

        {/* Hint text - Hidden on very small screens */}
        <p className="text-[10px] sm:text-xs text-muted-foreground text-center mt-1.5 sm:mt-2 hidden xs:block">
          Press Enter to send
        </p>
      </form>
    </div>
  );
}

import { useChat } from "@ai-sdk/react";
import { env } from "@memorystack/env/web";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/dashboard/ai")({
  component: AIChatPage,
});

function AIChatPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: `${env.VITE_SERVER_URL}/ai`,
    }),
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) {
      return;
    }
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="mb-4">
        <h1 className="font-bold text-3xl tracking-tight">AI Chat</h1>
        <p className="text-muted-foreground">
          Chat with our AI assistant to get help with your questions
        </p>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border bg-card">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Ask me anything to get started!
            </div>
          ) : (
            messages.map((message) => (
              <div
                className={`rounded-lg p-3 ${
                  message.role === "user"
                    ? "ml-8 bg-primary/10"
                    : "mr-8 bg-secondary/50"
                }`}
                key={message.id}
              >
                <p className="mb-1 font-semibold text-sm">
                  {message.role === "user" ? "You" : "AI Assistant"}
                </p>
                {message.parts?.map((part, index) => {
                  if (part.type === "text") {
                    return (
                      <Streamdown
                        isAnimating={
                          status === "streaming" && message.role === "assistant"
                        }
                        key={index}
                      >
                        {part.text}
                      </Streamdown>
                    );
                  }
                  return null;
                })}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form
          className="flex items-center gap-2 border-t bg-background p-4"
          onSubmit={handleSubmit}
        >
          <Input
            autoComplete="off"
            autoFocus
            className="flex-1"
            name="prompt"
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            value={input}
          />
          <Button size="icon" type="submit">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

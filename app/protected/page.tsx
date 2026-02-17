import { ChatInterface } from "@/components/chat/chat-interface";

export default function ProtectedPage() {
  return (
    <div className="flex-1 w-full max-w-4xl mx-auto flex flex-col">
      <ChatInterface />
    </div>
  );
}

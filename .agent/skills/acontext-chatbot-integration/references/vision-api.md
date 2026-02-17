# Vision API (Multimodal Content)

## User Image Upload

```ts
interface ImageMessage {
  role: "user";
  content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
}

// Store message with image
await acontext.sessions.storeMessage(sessionId, {
  role: "user",
  content: [
    { type: "text", text: "What's in this image?" },
    { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
  ]
});

// Load - format preserved
const messages = await acontext.sessions.getMessages(sessionId);
// messages.items[0].content can be string or ContentPart[]
```

## Image Processing Flow

```ts
// 1. Upload image to Disk
const imageBuffer = await file.arrayBuffer();
const artifact = await acontext.disks.artifacts.upsert(diskId, {
  file: new FileUpload("upload.png", Buffer.from(imageBuffer), "image/png"),
  file_path: "/uploads/",
});

// 2. Get public URL
const result = await acontext.disks.artifacts.get(diskId, {
  file_path: "/uploads/",
  filename: "upload.png",
  with_public_url: true,
});

// 3. Construct Vision API message
const message = {
  role: "user",
  content: [
    { type: "text", text: "Please analyze this image" },
    { type: "image_url", image_url: { url: result.public_url } }
  ]
};
```

## Type Definitions

```ts
interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}
```

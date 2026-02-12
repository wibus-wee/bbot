---
name: pi-mono
description: "Unified LLM API library (@mariozechner/pi-ai) for TypeScript/JavaScript that abstracts provider differences across OpenAI, Anthropic, Google, Azure, Mistral, Groq, xAI, Cerebras, Amazon Bedrock, GitHub Copilot, and OpenAI-compatible services. Use when implementing LLM integrations, building agentic workflows with tool calling, switching between AI providers, managing conversation context, handling streaming responses, implementing vision capabilities, or tracking token usage and costs. Triggers on installing/configuring pi-ai, defining tools with TypeBox schemas, implementing stream/complete calls, handling tool calls and results, cross-provider handoffs, context serialization, or any multi-provider LLM integration work."
---

# Pi-Mono (@mariozechner/pi-ai)

Unified LLM API that abstracts away provider differences, enabling seamless switching between AI models and providers while maintaining type safety and supporting tool calling for agentic workflows.

## Quick Start

Install the library:

```bash
npm install @mariozechner/pi-ai
```

Basic usage pattern (see `assets/basic-setup.ts` for complete example):

```typescript
import { stream, getModel, type Context, type Tool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

// 1. Define tools with TypeBox schemas
const tools: Tool[] = [{
  name: "get_weather",
  description: "Get current weather for a location",
  parameters: Type.Object({
    location: Type.String({ description: "City name" })
  })
}];

// 2. Build context
const context: Context = {
  system: "You are a helpful assistant.",
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }]
};

// 3. Stream or complete
const model = getModel("claude-3-5-sonnet-20241022");
for await (const event of stream(model, context, tools)) {
  if (event.type === "text") process.stdout.write(event.text);
  if (event.type === "tool_call") {
    // Execute tool and add result back to context
  }
}
```

## Core Capabilities

### 1. Multi-Provider Support

Switch between providers seamlessly:

```typescript
// Use any supported model
const claude = getModel("claude-3-5-sonnet-20241022");
const gpt = getModel("gpt-4o");
const gemini = getModel("gemini-2.0-flash-exp");

// Same API for all providers
const result = await complete(claude, context, tools);
```

Supported providers: OpenAI, Anthropic, Google, Azure, Mistral, Groq, xAI, Cerebras, Amazon Bedrock, GitHub Copilot, and OpenAI-compatible services (Ollama, vLLM, LM Studio).

### 2. Tool Calling (Function Calling)

All models in this library support tool calling, essential for agentic workflows:

```typescript
// Define tools with TypeBox for automatic validation
const tools: Tool[] = [{
  name: "search_database",
  description: "Search the product database",
  parameters: Type.Object({
    query: Type.String(),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 }))
  })
}];

// Handle tool calls in streaming
for await (const event of stream(model, context, tools)) {
  if (event.type === "tool_call") {
    const result = await executeToolCall(event.name, event.args);

    // Add tool call and result to context
    context.messages.push({
      role: "assistant",
      content: [{ type: "tool_call", id: event.id, name: event.name, args: event.args }]
    });
    context.messages.push({
      role: "user",
      content: [{ type: "tool_result", id: event.id, result }]
    });
  }
}
```

### 3. Streaming & Events

Granular event types for real-time processing:

```typescript
for await (const event of stream(model, context, tools)) {
  switch (event.type) {
    case "text":
      // Incremental text chunks
      process.stdout.write(event.text);
      break;
    case "thinking":
      // Extended thinking/reasoning blocks
      console.log("Thinking:", event.text);
      break;
    case "tool_call":
      // Tool invocation with validated args
      await handleToolCall(event);
      break;
    case "done":
      // Final usage and cost tracking
      console.log("Tokens:", event.usage);
      console.log("Cost:", event.cost);
      break;
    case "error":
      // Error handling
      console.error(event.error);
      break;
  }
}
```

### 4. Cross-Provider Handoffs

Transfer conversations between providers while preserving context:

```typescript
// Start with Claude
const context: Context = {
  system: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Explain quantum computing" }]
};

const claude = getModel("claude-3-5-sonnet-20241022");
await complete(claude, context);

// Continue with GPT-4 - context preserved
const gpt = getModel("gpt-4o");
context.messages.push({ role: "user", content: "Now explain it for a 5-year-old" });
await complete(gpt, context);
```

### 5. Context Serialization

Persist and resume conversations:

```typescript
// Serialize context to JSON
const serialized = JSON.stringify(context);
await fs.writeFile("conversation.json", serialized);

// Resume later
const restored: Context = JSON.parse(await fs.readFile("conversation.json", "utf-8"));
await complete(model, restored, tools);
```

### 6. Vision Support

Handle image inputs for vision-capable models:

```typescript
const context: Context = {
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "What's in this image?" },
      { type: "image", source: { type: "url", url: "https://example.com/image.jpg" } }
    ]
  }]
};

const result = await complete(getModel("gpt-4o"), context);
```

### 7. Reasoning/Thinking

Enable extended thinking modes:

```typescript
// Unified interface (automatically uses provider's thinking mode)
const result = await completeSimple(model, "Solve this complex problem", { thinking: true });

// Provider-specific options
const result = await complete(model, context, tools, {
  thinking: { type: "enabled", budget_tokens: 10000 } // Claude
});
```

### 8. Token & Cost Tracking

Automatic usage reporting:

```typescript
const result = await complete(model, context, tools);
console.log("Input tokens:", result.usage.input_tokens);
console.log("Output tokens:", result.usage.output_tokens);
console.log("Total cost:", result.cost); // In USD
```

## Common Workflows

### Agentic Loop with Tool Calling

```typescript
async function agenticLoop(model: Model, initialPrompt: string, tools: Tool[]) {
  const context: Context = {
    system: "You are a helpful assistant with access to tools.",
    messages: [{ role: "user", content: initialPrompt }]
  };

  let continueLoop = true;
  while (continueLoop) {
    continueLoop = false;

    for await (const event of stream(model, context, tools)) {
      if (event.type === "text") {
        process.stdout.write(event.text);
      } else if (event.type === "tool_call") {
        // Execute tool
        const result = await executeToolCall(event.name, event.args);

        // Add to context
        context.messages.push({
          role: "assistant",
          content: [{ type: "tool_call", id: event.id, name: event.name, args: event.args }]
        });
        context.messages.push({
          role: "user",
          content: [{ type: "tool_result", id: event.id, result }]
        });

        // Continue loop to process tool result
        continueLoop = true;
      }
    }
  }
}
```

### Provider Fallback

```typescript
async function completeWithFallback(context: Context, tools: Tool[]) {
  const providers = ["claude-3-5-sonnet-20241022", "gpt-4o", "gemini-2.0-flash-exp"];

  for (const modelId of providers) {
    try {
      const model = getModel(modelId);
      return await complete(model, context, tools);
    } catch (error) {
      console.error(`${modelId} failed:`, error);
      // Try next provider
    }
  }

  throw new Error("All providers failed");
}
```

## Authentication

Set environment variables for providers:

```bash
# OpenAI
export OPENAI_API_KEY="sk-..."

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."

# Google
export GOOGLE_API_KEY="..."

# Azure
export AZURE_OPENAI_API_KEY="..."
export AZURE_OPENAI_ENDPOINT="https://..."

# Others: MISTRAL_API_KEY, GROQ_API_KEY, XAI_API_KEY, etc.
```

Or pass explicitly:

```typescript
const model = getModel("gpt-4o", { apiKey: "sk-..." });
```

## Reference Documentation

For detailed API documentation, examples, and advanced features, see:
- **[references/pi-ai-docs.md](references/pi-ai-docs.md)** - Complete official documentation

Key sections in the reference:
- Tool calling with partial JSON streaming
- Error handling and abort patterns
- Custom model configuration
- OAuth provider setup
- Browser usage considerations
- OpenAI compatibility settings

## Resources

- **references/pi-ai-docs.md** - Full official documentation from the pi-ai repository

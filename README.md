# Context Prewarm Extension for SillyTavern

A SillyTavern extension that automatically pre-warms your local LLM's KV cache after each AI response, making your next message generate much faster.

## The Problem

When using local LLMs (via llama.cpp, koboldcpp, text-generation-webui, etc.), there's often a delay before the AI starts generating a response. This is because the LLM needs to process (tokenize and compute attention for) the entire conversation context before it can generate new tokens.

If you've ever noticed that sending an empty message, canceling it, and then sending your real message results in a much faster response - that's because the KV cache is already "warm" with the conversation context.

## The Solution

This extension automates that process. After each AI response completes, it automatically:

1. Injects a temporary user message into the context
2. Sends it to your LLM endpoint (warming the KV cache)
3. Immediately cancels the generation
4. Cleans up the temporary message

When you send your next real message, the LLM only needs to process the new tokens instead of re-processing the entire conversation.

## Installation

### Using SillyTavern's Extension Installer (Recommended)

1. Open SillyTavern
2. Click the **Extensions** button (puzzle piece icon) in the top menu
3. Click **Install extension**
4. Paste this URL: `https://github.com/tomt610/sillytavern-prewarm`
5. Click **Save**

The extension will be automatically downloaded and activated.

### Manual Installation

1. Download this repository as a ZIP
2. Extract to `SillyTavern/data/<user-handle>/extensions/prewarm/`
3. Restart SillyTavern

## Configuration

After installation, find **Context Prewarm** in the Extensions panel (puzzle piece icon).

### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable Context Prewarm** | Toggle the feature on/off | Off |
| **Prewarm Mode** | How to prewarm the cache (see below) | User Message |
| **Prewarm Message** | The temporary message to send | `.` |
| **Delay before cancel (ms)** | How long to wait before canceling | 500ms |

### Prewarm Modes

- **User Message (recommended)**: Simulates sending a user message. This is what you'd do manually and works with most setups.
- **Quiet/Continue**: Uses background generation like AI continue. Try this if User Message mode doesn't work for your setup.

### Tuning the Delay

The delay setting controls how long to wait before canceling the prewarm request. This needs to be long enough for the context to be sent to your LLM endpoint.

- **Too short**: Context won't be fully processed, prewarm won't be effective
- **Too long**: Wastes time and compute

Start with 500ms and adjust based on your setup. If you have a slow connection to your LLM or a very long context, you may need to increase this.

## How It Works

1. Listens for the `GENERATION_ENDED` event (when AI finishes responding)
2. Skips prewarm for swipes, regenerates, and continues (only triggers after normal messages)
3. Temporarily adds a user message to the chat context
4. Starts a quiet generation request to the LLM
5. Cancels after the configured delay
6. Removes the temporary message and saves

The prewarm happens invisibly - you won't see any flashing messages in the UI.

## Compatibility

- Works with any local LLM backend that supports KV caching (llama.cpp, koboldcpp, text-generation-webui, etc.)
- May not provide benefits with cloud APIs (OpenAI, Claude, etc.) as they manage their own caching

## Troubleshooting

**Prewarm doesn't seem to help:**
- Increase the delay setting
- Make sure your LLM backend actually supports KV caching
- Check the browser console for `[Prewarm]` log messages

**Swipe buttons disappear:**
- This was fixed in later versions. Make sure you have the latest version.

**Prewarm message gets stuck in chat:**
- Delete the stuck message manually
- Make sure you have the latest version which properly cleans up

## License

MIT License - Feel free to use, modify, and distribute.

## Credits

Created for the SillyTavern community.

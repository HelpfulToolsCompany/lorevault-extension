# LoreVault - Memory Extension for SillyTavern

LoreVault is a hosted memory-as-a-service extension that automatically manages long-term memory for your roleplay conversations. Never lose track of characters, relationships, or story events again.

## Features

- **Automatic Memory** - Messages are automatically summarized and stored
- **Semantic Search** - Retrieves relevant context based on meaning, not just keywords
- **Character Tracking** - Tracks character states, emotions, and relationships
- **POV Filtering** - Only surfaces information characters would actually know
- **Zero Configuration** - Just register with your email and start chatting

## Installation

### Method 1: SillyTavern Extension Installer (Recommended)

1. Open SillyTavern
2. Go to Extensions panel
3. Click "Install Extension"
4. Paste this URL: `https://github.com/HelpfulToolsCompany/lorevault-extension`
5. Click Install

### Method 2: Manual Installation

1. Download this repository as ZIP
2. Extract to `SillyTavern/data/<user>/extensions/third-party/lorevault`
3. Restart SillyTavern

## Setup

1. Open Extensions panel in SillyTavern
2. Find "LoreVault" section
3. Enter your email and click "Generate API Key"
4. That's it! LoreVault will automatically start tracking your conversations

## How It Works

1. **Ingest**: As you chat, messages are sent to LoreVault in batches
2. **Extract**: AI extracts characters, relationships, locations, and events
3. **Store**: Everything is stored with semantic embeddings for smart retrieval
4. **Retrieve**: Before each AI response, relevant context is injected into the prompt

## Tiers

LoreVault offers Free and Pro tiers. Pro users get more storage and unlimited daily usage. Contact us for details.

## Privacy & Trust

- **Your data is yours** - Delete everything with one click anytime (right in the extension UI)
- **No content filtering** - We don't judge or restrict your RP content
- **No training on your data** - Your conversations are never used to train models
- **Email only** - No password, no personal info beyond email for account recovery
- **Open source client** - The extension code is fully visible here, see exactly what it sends
- **Encrypted at rest** - All data encrypted in the database
- **No third-party analytics** - No tracking scripts, no selling data, no ads
- **GDPR compliant** - Request a full data export anytime

## Support

Currently in beta. For Pro access or support, contact us through GitHub issues.

## License

MIT

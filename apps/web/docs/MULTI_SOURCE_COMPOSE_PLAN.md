# Multi-Source Compose Architecture Plan

## Executive Summary

Transform the compose feature from email-only to a multi-source capable system that supports composing messages across Email, Slack, WhatsApp, and potentially other sources, while maintaining the AI-assisted intelligence features.

---

## Current State

### What Exists
- **ComposeDialog** (`/components/compose/compose-dialog.tsx`) - 1,193 lines
- Full email composition with:
  - AI-assisted drafting (generate, refine, placeholders)
  - Multi-recipient support (To, Cc, Bcc)
  - Attachments (25MB per file, 50MB total)
  - Draft management
  - Reply/forward threading
  - Contradiction checking (validates against existing commitments)
- **Backend** (`/apps/server/src/routes/compose.ts`) - Email-only API

### Sources in Unified Inbox
| Source | Compose Needed? | Complexity | API Available |
|--------|-----------------|------------|---------------|
| Email | ✅ Already done | Medium | Gmail API |
| Slack | ✅ Yes | Medium | Slack API |
| WhatsApp | ✅ Yes | High | WhatsApp Business API |
| Calendar | ❌ No (create events, not compose) | N/A | Google Calendar API |
| Notion | ⚠️ Maybe (comments/pages) | Low | Notion API |
| Google Docs | ⚠️ Maybe (comments) | Low | Google Docs API |

---

## Architecture Options

### Option A: Unified Smart Compose (Recommended)

**Concept**: Single compose dialog that adapts UI and behavior based on selected source type.

```
┌─────────────────────────────────────────────────────┐
│  Compose                                       [X]  │
├─────────────────────────────────────────────────────┤
│  Source: [Email ▼] [Slack] [WhatsApp]              │
├─────────────────────────────────────────────────────┤
│  [Dynamic fields based on source]                   │
│                                                     │
│  Email:    To, Cc, Bcc, Subject, Body, Attachments │
│  Slack:    Channel/DM, Message, Thread reply       │
│  WhatsApp: Phone/Contact, Message, Media           │
├─────────────────────────────────────────────────────┤
│  [AI Assist] [Send] [Save Draft]                   │
└─────────────────────────────────────────────────────┘
```

**Pros**:
- Single entry point (Cmd+C, Compose button)
- Consistent AI assistance across sources
- Easier to extend to new sources
- Users learn one interface

**Cons**:
- More complex dialog component
- Some sources have very different UX needs
- May feel like a compromise for power users

### Option B: Source-Specific Compose Dialogs

**Concept**: Separate compose components for each source, each optimized for its use case.

```
/components/compose/
├── compose-email.tsx      # Current compose-dialog
├── compose-slack.tsx      # Slack-specific
├── compose-whatsapp.tsx   # WhatsApp-specific
└── compose-router.tsx     # Routes to appropriate compose
```

**Pros**:
- Best UX per source
- Easier to implement incrementally
- Can match native app experience closely

**Cons**:
- Code duplication (especially AI features)
- Inconsistent learning curve
- More maintenance burden

### Option C: Contextual Compose

**Concept**: Compose button behavior changes based on current inbox filter.

```
Viewing "All"      → Opens source picker → Selected compose
Viewing "Email"    → Opens email compose directly
Viewing "Slack"    → Opens Slack compose directly
Replying to item   → Opens compose for that source
```

**Pros**:
- Most intuitive for users
- No source selection step in filtered views
- Natural extension of current UX

**Cons**:
- "All" view still needs source selection
- Complex state management
- May be confusing when switching contexts

---

## Recommended Architecture: Hybrid Approach

Combine Options A and C:

1. **Global compose** (Cmd+C from anywhere): Opens unified compose with source selector
2. **Contextual compose** (from filtered views): Pre-selects source based on context
3. **Reply/forward**: Auto-selects source from original message

### Component Structure

```
/components/compose/
├── index.ts                    # Exports
├── compose-dialog.tsx          # Main wrapper with source routing
├── compose-provider.tsx        # Context for compose state
│
├── sources/
│   ├── email-compose.tsx       # Email-specific fields/logic
│   ├── slack-compose.tsx       # Slack-specific fields/logic
│   ├── whatsapp-compose.tsx    # WhatsApp-specific fields/logic
│   └── source-selector.tsx     # Source type picker
│
├── shared/
│   ├── ai-assist-panel.tsx     # AI drafting (shared)
│   ├── recipient-field.tsx     # Generic recipient input
│   ├── attachment-zone.tsx     # File uploads (shared)
│   └── contradiction-check.tsx # Commitment validation (shared)
│
└── hooks/
    ├── use-compose.ts          # Compose state management
    ├── use-send-message.ts     # Unified send abstraction
    └── use-ai-draft.ts         # AI assistance hook
```

### Data Model

```typescript
interface ComposeState {
  // Common fields
  sourceType: "email" | "slack" | "whatsapp";
  sourceAccountId: string;
  body: string;
  attachments: File[];

  // Reply context (optional)
  replyTo?: {
    conversationId: string;
    messageId?: string;
  };

  // Source-specific fields
  email?: {
    to: Recipient[];
    cc: Recipient[];
    bcc: Recipient[];
    subject: string;
  };

  slack?: {
    channelId: string;
    threadTs?: string; // For thread replies
  };

  whatsapp?: {
    phoneNumber: string;
    contactName?: string;
  };
}

interface SendMessageInput {
  sourceType: string;
  sourceAccountId: string;
  // Polymorphic payload based on sourceType
  payload: EmailPayload | SlackPayload | WhatsAppPayload;
}
```

### API Design

```
POST /api/compose/send
  Body: { sourceType, sourceAccountId, payload }

  Internally routes to:
  - sourceType: "email"    → Gmail API
  - sourceType: "slack"    → Slack API
  - sourceType: "whatsapp" → WhatsApp Business API

POST /api/compose/draft
  Body: { sourceType, sourceAccountId, payload }

  Stores draft in unified drafts table with source context
```

---

## Implementation Phases

### Phase 1: Refactor Email Compose (1-2 days)
- [ ] Extract shared components (AI assist, attachments, contradiction check)
- [ ] Create ComposeProvider context
- [ ] Abstract email-specific logic into `email-compose.tsx`
- [ ] Ensure no regression in current functionality

### Phase 2: Add Source Selector (1 day)
- [ ] Create source selector component
- [ ] Add source routing in compose-dialog
- [ ] Update CommandBar compose to use source context
- [ ] Handle contextual source pre-selection

### Phase 3: Slack Compose (2-3 days)
- [ ] Create `slack-compose.tsx` with channel/DM picker
- [ ] Implement Slack message API endpoint
- [ ] Add thread reply support
- [ ] Test with real Slack workspace

### Phase 4: WhatsApp Compose (2-3 days)
- [ ] Create `whatsapp-compose.tsx` with contact picker
- [ ] Implement WhatsApp Business API endpoint
- [ ] Handle phone number validation
- [ ] Test with WhatsApp Business account

### Phase 5: AI Integration (1-2 days)
- [ ] Extend AI drafting to work with all sources
- [ ] Adapt tone/style suggestions per source
- [ ] Ensure contradiction checking works cross-source

### Phase 6: Polish & Testing (2 days)
- [ ] End-to-end testing all flows
- [ ] Keyboard shortcuts
- [ ] Error handling and edge cases
- [ ] Performance optimization

---

## UI/UX Considerations

### Source Indicator
Show clear visual indicator of which source will receive the message:
```
[Gmail icon] Sending as: jeremy@company.com
[Slack icon] Posting to: #general
[WhatsApp icon] Messaging: +1 234 567 8900
```

### Smart Defaults
- If replying: Use same source as original
- If last used: Remember preference
- If contextual: Use current filter's source

### Keyboard Shortcuts
- `Cmd+C`: Open compose (global)
- `Cmd+1/2/3`: Switch source in compose
- `Cmd+Enter`: Send
- `Cmd+J`: AI assist
- `Esc`: Close/discard

### Error States
- Source account disconnected
- Rate limits per source
- Message too long (varies by source)
- Invalid recipients

---

## Questions to Resolve

1. **Drafts**: Should drafts be unified or per-source?
   - Recommendation: Unified with source metadata

2. **Attachments**: How to handle different attachment limits?
   - Email: 25MB
   - Slack: 1GB (but slow)
   - WhatsApp: 16MB for media
   - Recommendation: Show source-specific limits, warn on exceed

3. **AI Tone**: Should AI adapt suggestions per source?
   - Email: Formal options
   - Slack: Casual default
   - WhatsApp: Very casual
   - Recommendation: Yes, with source-aware prompts

4. **Threading**: How deep should thread support go?
   - Email: Full threading
   - Slack: Thread replies
   - WhatsApp: No threading (linear chat)
   - Recommendation: Support where available, hide where not

---

## Success Metrics

- [ ] Can compose and send via all 3 primary sources
- [ ] AI assist works for all sources
- [ ] Reply flow works seamlessly
- [ ] No regression in email compose performance
- [ ] Source switching feels natural
- [ ] Contradiction checking works cross-source

---

## Files to Create/Modify

### New Files
| Path | Purpose |
|------|---------|
| `/components/compose/compose-provider.tsx` | Compose state context |
| `/components/compose/sources/email-compose.tsx` | Email fields |
| `/components/compose/sources/slack-compose.tsx` | Slack fields |
| `/components/compose/sources/whatsapp-compose.tsx` | WhatsApp fields |
| `/components/compose/sources/source-selector.tsx` | Source picker |
| `/components/compose/shared/ai-assist-panel.tsx` | Shared AI UI |
| `/apps/server/src/routes/compose-slack.ts` | Slack send API |
| `/apps/server/src/routes/compose-whatsapp.ts` | WhatsApp send API |

### Modified Files
| Path | Changes |
|------|---------|
| `/components/compose/compose-dialog.tsx` | Refactor to use providers and routing |
| `/components/compose/recipient-field.tsx` | Generalize for multi-source |
| `/apps/server/src/routes/compose.ts` | Add source routing |

---

## Appendix: Source-Specific Requirements

### Email
- Recipients: To, Cc, Bcc (email addresses)
- Subject line required
- HTML/plain text body
- Attachments up to 25MB
- Threading via In-Reply-To header

### Slack
- Target: Channel ID or User ID (DM)
- Plain text + markdown body
- Attachments via file upload
- Thread replies via thread_ts
- @mentions support

### WhatsApp
- Target: Phone number (E.164 format)
- Plain text body (limited formatting)
- Media attachments (images, documents)
- No threading (linear conversation)
- Template messages for first contact

---

*Plan created: 2025-01-20*
*Status: Ready for review*

# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**

- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`

**tRPC + React Query (CRITICAL):**

Always use the `queryOptions` and `mutationOptions` pattern with React Query's `useQuery` and `useMutation`. Never use the legacy tRPC hooks directly.

```typescript
// ✅ CORRECT - Use queryOptions + useQuery
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";

function MyComponent() {
  const trpc = useTRPC();

  // Queries - use queryOptions
  const { data, isLoading } = useQuery(
    trpc.threads.getById.queryOptions({ threadId: "123" })
  );

  // Mutations - use mutationOptions
  const archiveMutation = useMutation(
    trpc.threads.archive.mutationOptions()
  );

  // With callbacks
  const updateMutation = useMutation(
    trpc.threads.update.mutationOptions({
      onSuccess: (data) => {
        // handle success
      },
      onError: (error) => {
        // handle error
      },
    })
  );
}

// ❌ WRONG - Don't use legacy tRPC hooks
const { data } = trpc.threads.getById.useQuery({ threadId: "123" });
const mutation = trpc.threads.archive.useMutation();
```

This pattern provides:
- Better TypeScript inference
- Composable query/mutation options
- Consistent with React Query best practices
- Easier testing and query key management

**Solid/Svelte/Vue/Qwik:**

- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `bun x ultracite fix` before committing to ensure compliance.

---

## Drovi UI Design Principles

This is a **transformational AI-native email intelligence platform**. The UI must reflect this ambition - we're not building another email client, we're building the future of knowledge work.

### Design Philosophy

**Think Outside the Box**
- Challenge every email client convention - if Gmail/Outlook does it, ask "why?" and "can we do better?"
- The inbox is NOT a list of messages - it's a stream of decisions, commitments, and relationships
- Every interaction should feel like having an AI assistant sitting next to you
- Information density matters - power users want MORE context, not less
- The UI should make users feel smarter, not overwhelmed

### Visual Hierarchy Principles

1. **Intelligence First, Messages Second**
   - Thread briefs should be MORE prominent than subject lines
   - Commitments and decisions should have visual weight equal to message content
   - Open loops should create visual urgency (not just a badge count)
   - Confidence scores should be visible but not distracting

2. **Progressive Disclosure with Depth**
   - Surface-level: 3-line brief, suggested action, urgency indicator
   - One-click: Full intelligence panel (commitments, decisions, open questions)
   - Deep dive: Evidence chain, historical context, related threads
   - Never hide intelligence behind more than one click

3. **Contextual Intelligence**
   - When hovering over a person → Show relationship summary
   - When reading a commitment → Show evidence link
   - When composing → Show relevant history and contradictions
   - Every piece of data should link to its source

### Component Design Rules

**Use shadcn/ui for primitives** - buttons, inputs, dialogs, sheets, etc.
**Build custom for intelligence** - briefs, evidence links, confidence indicators, timeline views

**Intelligence Components Must Have:**
- Clear provenance (where did this come from?)
- Confidence indication (how sure is the AI?)
- One-click access to source evidence
- Ability to correct/dismiss
- Visual distinction from raw email content

**Command Bar (⌘K) is Sacred**
- This is the "Ask My Email" interface - treat it like a superpower
- Results should feel conversational, not like search results
- Citations must be clickable and obvious
- Support follow-up questions in context

### Interaction Patterns

**Speed is Trust**
- Intelligence should load progressively, not block the UI
- Skeleton states for intelligence panels
- Optimistic updates for all user actions
- Target: <100ms for any user-initiated action

**Keyboard-First Design**
- Every action must have a keyboard shortcut
- vim-style navigation for power users (j/k/h/l)
- Quick actions without leaving keyboard
- Command palette for everything

**AI Suggestions Should:**
- Be dismissible with one keystroke
- Learn from dismissals
- Never block the user's flow
- Show reasoning on hover/expand

### Color & Visual Language

**Intelligence Indicators:**
- High confidence: Solid, prominent
- Medium confidence: Slightly muted, dashed borders
- Low confidence: Faded, with "?" indicator
- User-corrected: Gold accent (user improved the AI)

**Priority/Urgency:**
- Urgent: Red accent, but NEVER obnoxious
- High: Orange/amber
- Medium: Default
- Low: Muted/gray

**Status Indicators:**
- Commitments: Blue family
- Decisions: Purple family
- Open loops: Amber/warning
- Risk alerts: Red family

### Anti-Patterns (NEVER DO)

- ❌ Don't make it look like Gmail with AI sprinkled on top
- ❌ Don't hide intelligence behind tabs or dropdowns
- ❌ Don't use generic loading spinners - show what's being computed
- ❌ Don't interrupt flow with modals for AI results
- ❌ Don't make evidence links look like footnotes nobody reads
- ❌ Don't sacrifice information density for "clean" design
- ❌ Don't use generic icons - intelligence types deserve custom visuals

### Aspirational References

- **Linear**: Speed, keyboard navigation, information density
- **Superhuman**: Email + intelligence integration, keyboard-first
- **Notion**: Progressive disclosure, block-based thinking
- **Raycast**: Command bar excellence, instant results
- **Arc**: Rethinking conventions, bold UI choices

### Implementation Notes

- Use `framer-motion` for meaningful animations (intelligence appearing, not gratuitous)
- Use `cmdk` for command palette foundation
- Use `react-hot-toast` or `sonner` for non-blocking notifications
- Use `@tanstack/virtual` for large lists (thousands of threads)
- Custom canvas/WebGL for timeline visualizations if needed

**Remember: We're building something people will use 8+ hours a day. Every pixel matters. Every interaction shapes their relationship with their email. Make it feel like magic.**

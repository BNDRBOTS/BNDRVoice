# Voice Engine

**A forensic voice capture and profile generation tool.**  
Paste a writing sample. Get a machine-readable voice blueprint and a human-readable instruction set — both engineered for direct use as AI system prompts.

Built by [BNDR](https://bndr.co).

---

## What It Does

Voice Engine reads a writing sample the way a typographer reads letterforms — every measurable pattern is evidence. It extracts tone, rhythm, sentence architecture, risk behavior, vocabulary register, and structural logic. Then it compiles those findings into a deployable voice profile: a JSON file and a plain-language instruction set that any AI tool can follow to write in that exact voice.

The output is not a mood board. It is a deterministic specification.

---

## How It Works

**Four steps. No setup. No backend.**

```
Step 1 — Sample     Paste 150–600 words of real writing
Step 2 — Analysis   AI reads the sample; extracts 16 voice dimensions
Step 3 — Configure  Set intent, audience, content type, enforceable filters
Step 4 — Generate   Two synced outputs: machine JSON + human instructions
```

Everything runs in the browser. API keys are stored in `sessionStorage` only — they clear when the tab closes and never leave your machine.

---

## Outputs

### Machine File (JSON)
A structured voice blueprint with seven top-level sections:

| Field | Contents |
|---|---|
| `voice_identity` | one-line summary, tone stack, energy, formality, risk tolerance |
| `writing_rules` | sentence structure, paragraph structure, openings, closings, rhythm, transitions |
| `vocabulary` | register, preferred patterns (4–6), banned words (10–14), brand words (3–5) |
| `structural_logic` | argument style, evidence preference, tension handling, opinion expression |
| `active_filters` | all enforced filters with their rules |
| `context` | goal, audience, content type, avoid topics |
| `system_prompt` | 250–400 word copy-paste-ready system prompt for any AI tool |

### Human Instructions
A formatted reference document covering every dimension. Includes the system prompt in a styled code block.

### Quality Check
An AI-scored audit comparing the generated profile against the original sample across five dimensions: tone accuracy, rhythm capture, vocabulary match, filter coverage, and drift resistance. Flags automatically if the overall score falls below 70.

---

## Enforceable Filters

Twelve hard behavioral constraints. Default active: `NO HYPE`, `NO HEDGING`, `NO PADDING`, `NO AI TELLS`.

| Filter | What It Blocks |
|---|---|
| NO HYPE | Superlatives, overclaiming, excitement inflation |
| NO HEDGING | might / could / perhaps weasel words |
| NO PADDING | Filler phrases and transitional fluff |
| NO AI TELLS | AI-fingerprint vocabulary (delve, leverage, etc.) |
| NO PASSIVE VOICE | Passive construction throughout |
| NO JARGON | Buzzwords and corporate-speak |
| NO SOFT CLOSES | Apologetic or tentative endings |
| NO OVER-EXPLAINING | Restating what was just said |
| NO FILLER OPENERS | "In today's world…" and similar throat-clears |
| NO EM-DASH ABUSE | Em-dash usage limited to intentional rhythm |
| NO DEFAULT LISTS | Reflexive bullet points over prose |
| NO FALSE ENTHUSIASM | Exclamation marks and hollow positivity |

---

## Supported Writing Contexts

**Content & Marketing**
Social media posts · Email newsletters · Sales copy / landing pages · Blog / long-form articles · Scripts / video content · Personal brand content · Mixed / general

**Business & Internal**
Internal business comms · Client proposals / pitches · Executive communications / thought leadership · Investor relations / shareholder communications · Press releases / corporate announcements

**Legal & Compliance**
Terms of service / legal agreements · Privacy policies / compliance documents · Contract and procurement language · Regulatory filings / government submissions · Policy documents / internal governance

---

## AI Providers

Three providers. Switch between them in the key modal without losing your session.

| Provider | Model | Notes |
|---|---|---|
| Anthropic | `claude-sonnet-4-20250514` | Default. Highest analysis fidelity. |
| OpenAI | `gpt-4o` | Browser-direct, no proxy required. |
| DeepSeek | `deepseek-chat` (V3.2) | 128K context. CORS varies by browser — use a proxy if blocked. |

API keys are session-only. They are never sent to any server other than the respective AI provider's API.

---

## Profiles

Up to 20 profiles saved to `localStorage`. Each profile stores:
- The full machine JSON
- The original voice analysis
- The first 500 characters of the writing sample (for QC re-runs)
- Timestamp and profile name

Profiles can be loaded, overwritten, or deleted from the bottom bar.

---

## Technical Spec

| Property | Value |
|---|---|
| Architecture | Single-file HTML — zero dependencies, zero build step |
| Storage | `sessionStorage` (API keys) · `localStorage` (profiles, max 20) |
| Fonts | Outfit (display) · Space Mono (mono) — loaded via Google Fonts |
| Minimum sample | 50 words to unlock analysis |
| Recommended sample | 150–600 words |
| Token budget — analysis | 1,500 |
| Token budget — generate | 2,500 |
| Token budget — QC | 800 |
| Browser support | All modern browsers (Chromium, Firefox, Safari) |

---

## Deployment

**Local:** Download the HTML file. Open in any browser. Done.

**Hosted:** Drop the single HTML file into any static host — Netlify, Vercel, GitHub Pages, S3, Cloudflare Pages. No server, no build process, no environment variables.

```bash
# GitHub Pages example
git init
git add APEXSound_VoiceEngine.html index.html
git commit -m "deploy"
git push origin main
# Enable Pages in repo settings → branch: main
```

Before deploying: replace the two placeholders in the file.

```html
<!-- Line ~477: logo -->
<img src="YOUR_LOGO_URL_HERE" alt="Brand Logo" class="logo-img">

<!-- Footer: privacy policy -->
<a href="YOUR_DROPBOX_LINK_HERE">PRIVACY POLICY</a>
```

---

## Project Structure

```
APEXSound_VoiceEngine.html
│
├── <style>
│   ├── Design tokens (:root CSS variables)
│   ├── Layout, header, step progress
│   ├── Modals (key, load profile)
│   ├── Form elements, filters, output tabs
│   ├── Quality check, bottom bar, footer
│   └── Animations, utilities
│
├── <body>
│   ├── Key modal (3-provider switcher)
│   ├── App container
│   │   ├── Header (logo + status + key button)
│   │   ├── Step progress bar
│   │   ├── Step 1: Writing sample + context
│   │   ├── Step 2: Analysis output + override
│   │   ├── Step 3: Configure (parameters + filters)
│   │   └── Step 4: Output (machine / human / QC tabs)
│   ├── Footer (copyright + privacy policy)
│   ├── Bottom bar (actions + provider badge)
│   └── Load profile modal
│
└── <script>
    ├── State object
    ├── Context → content type auto-map
    ├── Filter definitions (12)
    ├── Provider switching (Anthropic / DeepSeek / OpenAI)
    ├── API call functions (callClaude / callDeepSeek / callOpenAI)
    ├── Analysis: runAnalysis → renderAnalysis
    ├── Generate: runGenerate → buildHumanDoc → renderOutput
    ├── Quality check: runQualityCheck → renderQuality
    ├── Save / load / delete profiles
    └── Utilities (toast, download, export, slug, selectText)
```

---

## Design System

Built on the BNDR design token set.

```css
--black:   #090909   /* base background */
--surface: #0e0e0f   /* primary surface */
--panel:   #141415   /* panel background */
--panel2:  #1a1a1c   /* input background */
--bone:    #F4F1EC   /* primary text */
--mag:     #E0006A   /* brand accent — action, active state */
--ice:     #00C4FF   /* confirmation, pass state */
--amber:   #F5A623   /* warning */
--red:     #FF3B3B   /* error */
```

Typography: `Outfit` (weights 200–900) for display and UI. `Space Mono` for labels, code, metadata, and monospace panels.

---

## License

© BNDR. All rights reserved.  
This software is proprietary. Redistribution, resale, or modification without written permission is prohibited.  
[Privacy Policy](#)

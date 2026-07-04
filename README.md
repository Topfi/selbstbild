# Selbstbild

Generate an LLM-written personality assessment of your public **Hacker News**, **Reddit**, **Bluesky** or
**Mastodon** account.

*Selbstbild* (German: "self-image") fetches an account's public history, runs a multi-stage analysis pipeline
(parallel evidence readers → analyst passes → synthesis), and renders a report: an essay with verbatim quotes,
trait meters, activity and topic charts, a word cloud, and top-five lists. Reports can optionally be shared via
short link and deleted after the fact. See the [demo report](https://github.com/Topfi/selbstbild) (`/demo` route in the app).

## Privacy

- Your API key stays in the browser (memory by default, localStorage opt-in) and is sent only to
  `api.anthropic.com` or `openrouter.ai`.
- The fetched history is analyzed client-side and never uploaded.
- Only uses public history, there is no attempt or intend to ingest anything that isn't already visible publicly.
- Sharing is opt-in and uploads only the finished report to Cloudflare KV. Shares carry a deletion token,
  expire after 180 days, and are not indexed.
- No cookies, no analytics, no third-party embeds. Social "post to" buttons are plain intent links that load
  nothing until clicked. Turns out you aren't "forced" to have a cookie banner, it's each operators choice to have intrusive tracking and being informed about that is likely better than the alternative...

## Usage

1. Pick a provider (Anthropic or OpenRouter) and paste your key.
2. Enter your username.
3. Pick a depth. An exact cost estimate is shown before any tokens are spent.

| Depth | Pipeline | Anthropic default models |
|---|---|---|
| Quick | single pass | Haiku 4.5 |
| Standard | readers → synthesis | Haiku 4.5 → Sonnet 5 |
| Deep | readers → 3 analysts → synthesis | Haiku 4.5 → Sonnet 5 → Opus 4.8 |
| ★ Fable 5 | full pipeline | Haiku 4.5 readers → Fable 5 |
| ✳ Ultra | full pipeline | Fable 5 for every call |

Caveats:
- Reddit needs a one-click OAuth authorization and is capped by Reddit at ~1000 recent items per type.
- Mastodon history is only complete on the account's home instance.
- The Fable 5 tiers require an Anthropic org with standard (30-day) data retention and fall back to Opus 4.8 if a call is declined.

## Development

```sh
npm install
npm run dev          # SPA on :5173, share/OG endpoints proxied to :8787
npm run dev:worker   # wrangler dev (share Worker + KV, local)
npm test
```

Deploy on Cloudflare Workers:

```sh
npx wrangler login
npx wrangler kv namespace create SHARES   # put the id into wrangler.jsonc
npm run deploy
```

For Reddit support, register an "installed app" at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps)
with redirect URI `https://<your-domain>/reddit-callback` and build with `VITE_REDDIT_CLIENT_ID=<id>`
(a second app + `VITE_REDDIT_CLIENT_ID_DEV` for localhost).

## Architecture

Everything except sharing runs in your browser: platform adapters fetch public history over CORS, the pipeline
calls the LLM provider directly, and chart data (activity, word cloud, counts) is computed locally rather than
by the model. The Cloudflare Worker only stores opt-in shares (zod-validated, size-capped, rate-limited, hashed
deletion tokens) and renders share pages with OG meta and a preview image.

New platform adapters implement the `PlatformAdapter` interface in `src/lib/platforms/`. One rule: user data
must be fetched client-side. There are no server proxies.

## Review

Prompted from Fable 5. I have been using my personal comment history on HN early on for needle-in-haystack type testing and later (once the context windows especially at the frontier became decently robust), I retired it for that purpose, occasionally checking in with new pre-trains to get a very subjective assessment how a model goes about a very unstructured, high level summary. Found Fable 5 did a decent job there when I had a few percent of usage left a few hours before the reset, so decided to turn this into a project.

Did a review of the code on 04.07.2026. Reviewing code is never, ever exceptionally pleasant but most pages are static and the entire project is mostly local in browser anyways, with us using the OpenRouter / Anthropic APIs directly, so I was able to mainly focus on the sections concerned with local key storage and KV storage. Could have just removed that, for this project no persistence at all would have likely sufficed, but better to have something I feel I must verify than become to complacent. Overall, Fable 5 code output has been as nice to review as code one hasn't written by oneself can be, though I am very firm that Opus 4.8 would have likely produced (nearly) the same result.

That being said, it wasn't perfect and I doubt coding can be solved if A.) potential issues sneak in for a code base this straight forward and overrepresented in the training data and secondly, someone like myself can find said issues. LLMs are an amazing tool and Fable 5 is very helpful for development, but with "quality escapements" finding their way into a project this simple, I personally am far from being able to in good conciouns "not look at the code": 

Would a second pass with a model like Fable, Opus or GPT-5.5 have caught these? Likely, but if a second pass is necessary for such a straight forward task, I shudder to think what unreviewed, more complex code may hide...

## License

[EUPL-1.2](LICENSE)

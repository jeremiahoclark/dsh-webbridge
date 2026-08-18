# dsh-webbridge

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that hands the agent your real browser.

Most browser tools spin up a headless Chrome and start from zero. This one proxies the local [Kimi WebBridge](https://www.kimi.com/features/webbridge) service instead, so the agent navigates, reads, clicks, and types in the browser you already have open, with the logins you already have. No spun-up browser. No copied profile. No CDP.

Install the Kimi WebBridge extension and its local service first, and leave the daemon running.

## Install

```sh
dsh plugin --profile web add github:jeremiahoclark/dsh-webbridge
```

Use `--profile headless` for the headless profile, and restart the running dsh process so it reloads. From a local checkout:

```sh
git clone https://github.com/jeremiahoclark/dsh-webbridge.git
dsh plugin --profile web add ./dsh-webbridge
```

## Use

The `webbridge_*` tools show up in every session. Just ask for browser work:

> Open my GitHub notifications and summarize the unread ones.

The agent takes an accessibility snapshot, then clicks and fills against the `@e` refs the snapshot returns. Each dsh session keeps its own tab group, so it stays out of yours. `webbridge_status` tells you whether the daemon and extension are connected.

## Config

Defaults work when the daemon sits on `http://127.0.0.1:10086`. `DSH_WEBBRIDGE_BASE_URL` moves the endpoint, or set it per profile in that profile's `cordis.patch.yml`:

```yaml
- id: tool-webbridge
  config:
    baseURL: http://127.0.0.1:11086
    timeoutMs: 90000
    maxResponseBytes: 5000000
    sessionPrefix: dsh
```

One warning worth the words: `webbridge_evaluate` runs arbitrary JavaScript in a logged-in page, and every tool acts with that page's authority. Gate them with the dsh tool permission policy.

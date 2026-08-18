# dsh-webbridge

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that hands the agent your real browser. It proxies the local [Kimi WebBridge](https://www.kimi.com/features/webbridge) service, so the agent navigates, reads, clicks, and types in the browser you already have open, with the logins you already have. It starts no browser, copies no profile, and implements no CDP.

Install the Kimi WebBridge extension and its local service first, and leave the daemon running.

## Install

```sh
dsh plugin --profile web add github:jeremiahoclark/dsh-webbridge
```

Use `--profile headless` for the headless profile. Restart the running dsh process afterwards so it reloads the profile. From a local checkout instead:

```sh
git clone https://github.com/jeremiahoclark/dsh-webbridge.git
dsh plugin --profile web add ./dsh-webbridge
```

## Use

The `webbridge_*` tools show up in any session, so just ask for browser work:

> Open my GitHub notifications and summarize the unread ones.

The agent navigates, takes an accessibility snapshot, then clicks and fills against the `@e` refs that snapshot returns. Each dsh session keeps its own browser tab group. `webbridge_status` reports whether the daemon and extension are connected.

## Config

Defaults work when the daemon sits on `http://127.0.0.1:10086`. `DSH_WEBBRIDGE_BASE_URL` moves the endpoint. To set it per profile, add the row to that profile's `cordis.patch.yml`:

```yaml
- id: tool-webbridge
  config:
    baseURL: http://127.0.0.1:11086
    timeoutMs: 90000
    maxResponseBytes: 5000000
    sessionPrefix: dsh
```

`webbridge_evaluate` runs arbitrary JavaScript in a logged-in page, and the other tools act with that page's authority. Gate them with the dsh tool permission policy.

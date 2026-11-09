# uPHPtime Dashboard

A small, static, build-free dashboard for [uPHPtime](../uphptime) - plain HTML/CSS/JS, no backend of its
own, no Node toolchain. It polls one uPHPtime node's `GET /report/v1/overview` endpoint and shows every
site's uptime % for a chosen period, a group filter, and an overall figure recomputed client-side from
whatever's currently visible.

This is a deliberately separate project from the uPHPtime server itself: the server stays a lean,
dependency-light cron+API tool, and this dashboard's own release cycle (or a future rewrite with a real
build step, if it ever needs one) never touches it.

## One-time setup (on the node)

In the uPHPtime node's `config/node.json`, set a report API key (empty disables the endpoint entirely):

```json
{
  "report_api_key": "a long random string",
  "report_cors_allowed_origin": "*"
}
```

`report_cors_allowed_origin` can be narrowed to this dashboard's own origin instead of `*` once you know
where it'll be hosted.

## Running this dashboard

No build step. Serve the three files with anything that can serve static files - for local development,
reusing a tool you likely already have rather than adding a new one:

```shell
php -S 127.0.0.1:8081
```

Then open `http://127.0.0.1:8081/`, click **Settings**, and enter:

- **Node base URL** - e.g. `https://your-node.example` (no trailing path)
- **Report API key** - the `report_api_key` value from the node's config

Both are saved only in this browser's `localStorage`, never sent anywhere except that node URL.

## What it shows

- **Period**: day / month / overall (mirrors `bin/uphptime report --period=`)
- **Group**: filters to sites tagged with that group (`sites:add --groups=`); filtering is instant and
  client-side against the last fetched response, so it doesn't refetch per click
- **Overall card**: recomputed from whichever sites are currently visible (filtered or not) - summed check
  counts, not an average of per-site percentages, matching how the server itself computes an aggregate
- **Per-site table**: name, groups, state (up/down/suspect/unknown), uptime %, and raw pass/total counts

## Deploying

Any static file host works: upload `index.html`, `app.js` and `style.css` as-is. There's nothing to build
and nothing server-side to configure beyond CORS on the node side, if you're hosting this dashboard on a
different origin than the node.

## Docker

`Dockerfile` here builds this dashboard as its own image - `nginx:alpine` serving the three static files,
nothing else (no backend, no config baked in; you still enter the node URL/key through **Settings** in the
browser):

```shell
docker build -t uphptime-dashboard .
docker run --rm -p 48480:80 uphptime-dashboard
```

To bring up one uPHPtime node and this dashboard together with a single `docker compose up`, see
[`docker/with-dashboard/`](../uphptime/docker/with-dashboard/) in the `uphptime` repo (expects this repo
checked out as its sibling - that compose file just points its build `context` here and picks up this same
`Dockerfile`, no copy of it needed there) - it wires a demo site + report API key automatically.

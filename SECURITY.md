# Security deployment checklist

This Worker is intentionally deployed without a default `.workers.dev` route. Complete these steps before exposing a production custom domain.

## 1. Use private, high-entropy paths

Generate two independent paths and configure them as Worker variables:

```bash
openssl rand -hex 16
```

Set:

```jsonc
"DOH_PATH": "/<random-value>/dns-query",
"JSON_PATH": "/<different-random-value>/resolve"
```

Do not publish production paths in the repository.

## 2. Require a custom domain

Keep:

```jsonc
"workers_dev": false
```

Bind a domain only after the paths and access controls are ready.

## 3. Add Cloudflare abuse controls

On the custom domain, configure at least one of:

- Cloudflare WAF rate limiting
- Cloudflare custom rules
- Cloudflare Access, if the service is private

A starting point is to rate-limit exact requests to both configured API paths. Tune limits for your devices and expected DNS burst behavior.

## 4. Protect the source repository

For the public GitHub repository, enable:

- branch protection on `main`
- required CI status checks
- required review for changes
- secret scanning
- Dependabot alerts
- signed commits or another enforced review policy

The included CI workflow runs:

```text
npm ci
typecheck
tests
npm audit
wrangler deploy --dry-run
```

## 5. Privacy notes

Domestic DNS queries send a masked client subnet to DNSPod:

- IPv4: `/24`
- IPv6: `/56`

Other DNS queries do not send client ECS, but all upstream resolvers still see the queried domain. Do not log full URLs, DNS bodies, or client addresses in edge logs.

## Reporting

Use GitHub Security Advisories for private vulnerability reports. Do not open a public issue with exploit details.

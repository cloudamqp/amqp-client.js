# GitHub Copilot Coding Agent Allowlist

This document outlines the URLs and hosts that should be added to the GitHub Copilot Coding Agent allowlist to prevent firewall blocking issues.

## Required URLs/Hosts

### Ubuntu Package Repositories
- `esm.ubuntu.com` - Ubuntu Extended Security Maintenance repository
- `security.ubuntu.com` - Ubuntu security updates
- `archive.ubuntu.com` - Ubuntu main package repository  
- `packages.ubuntu.com` - Ubuntu package search
- `keyserver.ubuntu.com` - Ubuntu keyserver for package verification
- `ports.ubuntu.com` - Ubuntu ports repository (for non-x86 architectures)

### Node.js and npm Ecosystem
- `registry.npmjs.org` - npm package registry
- `npm.nodejs.org` - npm package registry mirror
- `nodejs.org` - Node.js official website and releases
- `github.com` - GitHub for package dependencies hosted on GitHub
- `raw.githubusercontent.com` - GitHub raw content for package files
- `api.github.com` - GitHub API for package metadata

### Homebrew (macOS/Linux)
- `formulae.brew.sh` - Homebrew formulae API
- `github.com/Homebrew` - Homebrew repositories on GitHub
- `raw.githubusercontent.com/Homebrew` - Homebrew formulae and casks
- `ghcr.io` - GitHub Container Registry (for Homebrew bottles)

### Docker and Container Registries
- `docker.io` - Docker Hub registry
- `registry-1.docker.io` - Docker Hub registry v1
- `index.docker.io` - Docker Hub index
- `auth.docker.io` - Docker Hub authentication
- `production.cloudflare.docker.com` - Docker CDN

### Certificate Authorities and Security
- `letsencrypt.org` - Let's Encrypt certificate authority
- `r3.o.lencr.org` - Let's Encrypt OCSP responder
- `ocsp.int-x3.letsencrypt.org` - Let's Encrypt OCSP responder

### Playwright (Browser Testing)
- `playwright.azureedge.net` - Playwright browser downloads
- `github.com/microsoft/playwright` - Playwright repository

### Additional Development Dependencies
- `cdn.jsdelivr.net` - jsDelivr CDN for packages
- `unpkg.com` - unpkg CDN for npm packages
- `esm.sh` - ES modules CDN

## Recommended Wildcard Allowlist Entries

For broader compatibility, these wildcard entries can be added:

- `*.ubuntu.com`
- `*.npmjs.org`
- `*.nodejs.org`  
- `*.github.com`
- `*.githubusercontent.com`
- `*.docker.io`
- `*.docker.com`
- `*.brew.sh`
- `*.letsencrypt.org`
- `*.azureedge.net`
- `*.jsdelivr.net`

## Configuration Location

To configure these allowlist entries:

1. Go to the repository's Copilot coding agent settings: 
   `https://github.com/cloudamqp/amqp-client.js/settings/copilot/coding_agent`

2. Add the URLs/hosts to the custom allowlist (admin access required)

## Notes

- The firewall blocking occurs because the Copilot coding agent environment has restricted network access by default
- The setup steps configuration (`.github/copilot/setup-steps.yml`) should handle most dependencies proactively
- Some URLs may only be needed during specific operations (testing, building, etc.)
- Monitor Copilot agent logs for additional blocked URLs that may need to be added
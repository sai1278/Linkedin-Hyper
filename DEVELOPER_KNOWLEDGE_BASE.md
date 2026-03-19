# LinkedIn Hyper-V — Master Project Prompt & Developer Knowledge Base

> **Purpose:** This is the single authoritative reference for every AI assistant, developer, or contributor working on this codebase. It documents the complete architecture, every feature, every component, every design decision, all data flows, all conventions, all known issues, and all operational requirements. Read this entire document before touching any file. When in doubt about anything, the answer is in here.

## 1. What This Project Is
A **self-hosted, multi-account LinkedIn automation dashboard** that allows a single operator to manage multiple LinkedIn accounts from a unified UI. There is no LinkedIn API, no Unipile, no third-party SaaS dependency. Everything runs in real Google Chrome instances inside Docker containers.

## Architecture Highlights
- **Frontend**: Next.js 16.1.1, App Router, Tailwind CSS v4
- **Worker**: Node.js 20, Express, rebrowser-playwright, Google Chrome Stable (headed with Xvfb)
- **Infra**: BullMQ, Redis, Docker Compose
- **Concurrency**: Hard-clamped at 1 per account.

*Please refer to the full document provided by the user in the prompt history for all deep-dives (Session, BullMQ Flows, Redis schemas, API Proxy, and UI components).*

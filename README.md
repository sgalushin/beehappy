# Beehappy

A private English vocabulary workspace for words encountered in real sentences. Definitions and generated examples use proper American English, without translation. Each word can contain several meanings and any number of saved examples within the documented request limits.

## Learning

- Add a word or phrase, its meanings, and sentences manually, or generate draft meanings/examples with Claude Sonnet 5.5 through OpenRouter. Generation never saves or overwrites an entry automatically.
- Select the exact occurrence to highlight in each sentence, including an inflected form. Original and generated sentences retain their provenance and optional source notes.
- Review either the word alone or a sentence with the selected occurrence in bold. Reveal the meanings, then choose **Again** or **Good**.
- Both modes update **one FSRS schedule per word**. Adding meanings or sentences does not create extra cards or reset progress. Context review excludes entries without sentences.
- Word details include history, next review, repetitions, lapses, and estimated recall. Progress shows observed recall results, learning states, daily activity, streak, mode breakdown, and the coming week's workload. Daily statistics use your browser's IANA time zone.
- Reviews use server time and atomic, versioned writes. Retried answers do not count twice; stale edits/reviews return a conflict instead of overwriting newer progress.
- Vocabulary and encountered sentences are private to the authenticated user. Deleting a word also removes its review history and its contribution to statistics.

## Stack

Matches the neighboring Redrat/Moonrabbit projects: Angular 22, signals, Nx 23, pnpm 12, Node 24, Rust/Axum, FSRS, DynamoDB, LocalStack, TypeScript AWS CDK, Cognito, API Gateway, ARM64 Lambda, S3, and CloudFront. No custom domain is required.

## Local development

Prerequisites: Node from `.node-version`, pnpm, stable Rust, Docker Compose, and AWS CLI. Lambda packaging additionally requires Zig and cargo-lambda.

```sh
cp .env.example .env
# Set OPENROUTER_API_KEY in .env to enable real generation.
pnpm install --frozen-lockfile
docker compose up -d --wait
```

Local DynamoDB uses the isolated port **4586**, table `beehappy-local`, and a persistent Docker volume. The API explicitly uses dummy local AWS credentials, not deployment credentials. API port: **9860**; web port: **9861**.

```sh
# Starts the emulator, API, and frontend together:
pnpm serve
```

Local `/config.json` has `auth: null`, and the API uses `DEV_USER=local` unless overridden. Production has no local authentication fallback: API Gateway validates Cognito tokens and the API partitions data by the validated subject. Do not expose the local development servers publicly.

## Verification

```sh
pnpm format:check
pnpm check
# Real DynamoDB regression, with LocalStack running:
cargo test --locked --manifest-path apps/api/Cargo.toml -- --ignored
# Real API scenario, with the API running:
node tools/smoke.mjs
# Also exercise paid Sonnet meaning/example generation:
SMOKE_AI=1 node tools/smoke.mjs
```

The smoke scenario creates and removes its own vocabulary entry. It checks Unicode highlights, multiple meanings, duplicate words, stale edits, duplicate/conflicting/stale review events, shared scheduling, and statistics. `SMOKE_BASE_URL` and `SMOKE_TOKEN` allow the same scenario against an authenticated deployed API; tokens are never printed. Sonnet calls use the running API's provider configuration.

## AWS and GitHub delivery

Stack: **Beehappy-prod**, region **us-east-2**. Infrastructure includes:

- Cognito managed login with self-registration disabled, optional authenticator MFA, and administrator-created accounts.
- Private S3 site behind CloudFront; HTTPS; same-origin `/api/*` routed to a Cognito-protected HTTP API and Rust Lambda.
- DynamoDB on-demand storage with point-in-time recovery. The table and user pool are retained on stack deletion.
- Runtime auth configuration generated from deployed Cognito resources; SPA callback URLs configured for the generated CloudFront hostname.

The target account must be CDK-bootstrapped:

```sh
pnpm exec cdk bootstrap aws://ACCOUNT_ID/us-east-2
```

GitHub repository secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `OPENROUTER_API_KEY`

The `production` environment is used for deployment. Pull requests run formatting, lint/type checking, tests, web/API builds, and strict CDK synthesis using dummy credentials. Pushes to `main` run the same checks and deploy **the exact build artifacts checked by that run**. Deployment is serialized; manual dispatch is supported. Dependabot maintains npm, Cargo, and GitHub Actions dependencies.

For an explicit local deployment after building:

```sh
pnpm exec nx run-many -t build
pnpm deploy
```

The deployment command loads `.env`, discovers the AWS account, and writes outputs to `cdk.out/outputs.json`. Credentials, synthesized templates, build outputs, and local data are excluded from Git.

### Invite a user

Use the deployed `UserPoolId` output in Cognito's **Create user** screen, or:

```sh
aws cognito-idp admin-create-user \
  --region us-east-2 \
  --user-pool-id USER_POOL_ID \
  --username person@example.com \
  --user-attributes Name=email,Value=person@example.com Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL
```

Cognito emails the temporary password; the user sets a permanent password at first sign-in. Use the deployed `SiteUrl` to enter the application. There is no public registration path.

## Operational boundaries

AI generation uses `anthropic/claude-sonnet-5.5`, validated structured output, a 24-second request deadline, and bounded request/response sizes. No application AI allowance is enforced. Hosting and provider usage are billed to the configured accounts.

The API queries each user's partition with DynamoDB pagination; it never scans a global vocabulary catalog. The initial interface retrieves a user's complete vocabulary/history for its personal-workspace views. No public sharing, browser extension, offline synchronization, audio, or import from the other applications is included.

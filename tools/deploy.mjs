import { spawnSync } from 'node:child_process';

if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required.');
const identity = spawnSync(
  'aws',
  ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'],
  { encoding: 'utf8' },
);
if (identity.status !== 0) {
  process.stderr.write(identity.stderr ?? 'AWS authentication failed.\n');
  process.exit(identity.status ?? 1);
}
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'cdk',
    'deploy',
    '--all',
    '--require-approval',
    'never',
    '--outputs-file',
    'cdk.out/outputs.json',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      CDK_DEFAULT_ACCOUNT: identity.stdout.trim(),
      AWS_DEFAULT_REGION: 'us-east-2',
      STAGE: process.env.STAGE ?? 'prod',
    },
  },
);
process.exit(result.status ?? 1);

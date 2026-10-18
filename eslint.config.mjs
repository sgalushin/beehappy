import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  { ignores: ['**/dist/**', '**/target/**', '**/out-tsc/**', '**/cdk.out/**', '**/.angular/**'] },
];

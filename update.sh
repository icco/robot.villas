#! /bin/zsh

set -ex

rm -rf package-lock.json dist node_modules

pnpm install
pnpm update
git add package* pnpm-lock.yaml
git diff --quiet --staged || git commit -m 'chore(deps): pnpm update'

pnpm run lint
git add src
git diff --quiet --staged || git commit -m 'chore: lint'

pnpm run build

git commit --allow-empty -m 'chore: redeploy'

git push -u

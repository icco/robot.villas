#! /bin/zsh

set -ex

rm -rf package-lock.json dist node_modules

yarn 
yarn upgrade 
git add package* yarn.lock
git diff --quiet --staged || git commit -m 'chore(deps): yarn upgrade'

yarn run lint 
git add src
git diff --quiet --staged || git commit -m 'chore: lint'

yarn run build

git commit --allow-empty -m 'chore: redeploy'

git push -u

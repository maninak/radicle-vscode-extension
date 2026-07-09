#!/usr/bin/env node

/*
 * A pre-push hook refusing any push that updates the remote's main branch. Changes reach
 * main only through pull requests; this catches push.default or upstream-tracking accidents
 * before they leave the machine. Deliberate override: `ALLOW_MAIN_PUSH=1 git push ...`.
 *
 * Git calls pre-push with the remote's name and URL as arguments and feeds one line per
 * ref update on stdin: `<local-ref> <local-sha> <remote-ref> <remote-sha>`.
 */

if (process.env.ALLOW_MAIN_PUSH === '1') {
  process.exit(0)
}

let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (stdin += chunk))
process.stdin.on('end', () => {
  const isPushingToMain = stdin
    .split('\n')
    .some((line) => line.split(' ')[2] === 'refs/heads/main')

  if (isPushingToMain) {
    process.stderr.write(
      'pre-push hook: refusing to push to main (use a PR). Override: ALLOW_MAIN_PUSH=1\n',
    )
    process.exit(1)
  }

  process.exit(0)
})

"""Refuses to publish what must stay on this PC.

Looks for personal paths (C:/Users/<name>, /home/<name>), the name of this PC and of its user,
e-mail addresses, build output, per-PC settings and game images in what is about to be published:

    python tools/check_leaks.py --staged          files of the commit being made (pre-commit hook)
    python tools/check_leaks.py --message FILE    its message (commit-msg hook)
    python tools/check_leaks.py --history         every commit of the repository (pre-push hook)
    python tools/check_leaks.py --zip FILE        a release archive (tools/build.ps1)

Words of your own that must never be published go in .git/info/leak-terms, one per line
(that file is never part of a commit). Enable the hooks once per clone:

    git config core.hooksPath .githooks
"""
import argparse
import getpass
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Names that are placeholders in documentation, not somebody's account.
PLACEHOLDERS = {'public', 'default', 'all users', 'you', 'your-name', 'yourname', 'your_name', 'name',
                'user', 'username', 'me', '%username%', '$env:username', 'runneradmin', 'runner'}
USER_PATHS = [
    re.compile(r'[A-Za-z]:[\\/]{1,4}(?:Users|Documents and Settings)[\\/]{1,4}([^\\/\s"\'<>|:*?,;)]+)', re.I),
    re.compile(r'(?<![\w.:/-])/(?:home|Users)/([A-Za-z0-9._-]+)'),
]
EMAIL = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}')
ALLOWED_EMAIL = re.compile(r'@(users\.noreply\.github\.com|example\.(com|org|net))$', re.I)

# Paths that never belong in the repository.
FORBIDDEN_IN_REPOSITORY = [
    (re.compile(r'(^|/)(obj|bin|__pycache__|dist|\.local|overlay-app)/'), 'build output or local folder'),
    (re.compile(r'(^|/)build(-[^/]*)?/'), 'packaging work folder'),
    (re.compile(r'\.(pdb|pyc|part|log|sav|zip|exe|dll)$', re.I), 'build output, save or log file'),
    (re.compile(r'^config\.json$'), 'per-PC settings'),
    (re.compile(r'^assets/'), 'game image (downloaded at first launch, never published)'),
    (re.compile(r'^maps/(?!.*_FairyFountain\.webp$)'), 'game image (downloaded at first launch, never published)'),
    (re.compile(r'^[^/]+\.(jpe?g|png|webp)$', re.I), 'image at the root (screenshots go in docs/)'),
]
# Paths that never belong in a release archive (relative to its top folder).
FORBIDDEN_IN_ARCHIVE = [
    (re.compile(r'(^|/)(obj|__pycache__|\.local|\.git)/'), 'build output or local folder'),
    (re.compile(r'\.(pdb|part|log|sav)$', re.I), 'build output, save or log file'),
    (re.compile(r'^config\.json$'), 'per-PC settings'),
    (re.compile(r'^assets/'), 'game image'),
    (re.compile(r'^maps/(?!.*_FairyFountain\.webp$)'), 'game image'),
]
# Third-party runtime in the archive (embedded Python, WebView2): only private words are searched there.
THIRD_PARTY = re.compile(r'^(server/|Microsoft\.Web\.WebView2|WebView2Loader|runtimes/)')


def git(*arguments, data=None):
    return subprocess.run(['git', *arguments], cwd=ROOT, input=data, stdout=subprocess.PIPE, check=True).stdout


def private_terms():
    """Words of this PC that must not be published: account, computer, and the user's own list."""
    terms = set()
    for value in (os.environ.get('USERNAME'), os.environ.get('USER'), os.environ.get('COMPUTERNAME'),
                  Path.home().name):
        if value: terms.add(value)
    try: terms.add(getpass.getuser())
    except Exception: pass
    try:
        listed = ROOT / git('rev-parse', '--git-path', 'info/leak-terms').decode().strip()
        terms.update(line.strip() for line in listed.read_text('utf-8').splitlines()
                     if line.strip() and not line.startswith('#'))
    except (OSError, subprocess.CalledProcessError, FileNotFoundError):
        pass
    # Very short names would match everywhere.
    return sorted(t.lower() for t in terms if len(t) >= 4 and t.lower() not in PLACEHOLDERS)


def contains(lowered, term):
    """Short words only count as whole words: a four-letter PC name is part of many ordinary words."""
    if len(term) >= 6: return term in lowered
    return re.search(r'(?<![a-z0-9])' + re.escape(term) + r'(?![a-z0-9])', lowered) is not None


def views(data):
    """The content as text, and again without NUL bytes so that UTF-16 strings of programs are seen."""
    yield data.decode('latin-1')
    if b'\0' in data:
        yield data.replace(b'\0', b'').decode('latin-1')


def scan_content(data, terms, generic=True):
    found = set()
    binary = b'\0' in data[:8000]
    for text in views(data):
        lowered = text.lower()
        for term in terms:
            if contains(lowered, term): found.add(f'private word "{term}"')
        if not generic: continue
        for pattern in USER_PATHS:
            for match in pattern.finditer(text):
                if match.group(1).lower().strip('<>[]{}') not in PLACEHOLDERS and not match.group(1).startswith(('<', '[', '{', '%', '$')):
                    found.add(f'personal path "{match.group(0)}"')
        if not binary:
            for match in EMAIL.finditer(text):
                if not ALLOWED_EMAIL.search(match.group(0)): found.add(f'e-mail address "{match.group(0)}"')
    return sorted(found)


def scan_path(path, rules):
    return [reason for pattern, reason in rules if pattern.search(path)]


def staged(terms):
    problems = []
    names = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').decode('utf-8').split('\0')
    for name in filter(None, names):
        for reason in scan_path(name, FORBIDDEN_IN_REPOSITORY): problems.append((name, reason))
        problems += [(name, f'private word "{t}" in the name') for t in terms if contains(name.lower(), t)]
        for reason in scan_content(git('show', ':' + name), terms): problems.append((name, reason))
    for variable in ('GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT'):
        identity = git('var', variable).decode('utf-8', 'replace').rsplit('>', 1)[0] + '>'
        problems += [('author of the commit', f'{reason} in {identity}') for reason in scan_identity(identity, terms)]
    return problems


def scan_identity(identity, terms):
    found = [f'private word "{t}"' for t in terms if contains(identity.lower(), t)]
    found += [f'e-mail address "{m}" (use your GitHub noreply address)' for m in EMAIL.findall(identity)
              if not ALLOWED_EMAIL.search(m)]
    return found


def message(path, terms):
    text = Path(path).read_bytes()
    lines = b'\n'.join(line for line in text.splitlines() if not line.startswith(b'#'))
    return [('commit message', reason) for reason in scan_content(lines, terms)]


def history(terms):
    problems, seen = [], set()
    listing = git('rev-list', '--all', '--objects').decode('utf-8', 'replace').splitlines()
    for line in listing:
        sha, _, name = line.partition(' ')
        if not name or sha in seen: continue
        seen.add(sha)
        if git('cat-file', '-t', sha).strip() != b'blob': continue
        for reason in scan_path(name, FORBIDDEN_IN_REPOSITORY): problems.append((f'{name} ({sha[:8]})', reason))
        for reason in scan_content(git('cat-file', 'blob', sha), terms): problems.append((f'{name} ({sha[:8]})', reason))
    for commit in git('rev-list', '--all').decode().split():
        details = git('show', '-s', '--format=%an <%ae>%n%cn <%ce>%n%B', commit)
        author, committer, body = details.decode('utf-8', 'replace').split('\n', 2)
        for identity in {author, committer}:
            problems += [(f'commit {commit[:8]}', f'{reason} in {identity}') for reason in scan_identity(identity, terms)]
        problems += [(f'commit {commit[:8]} message', reason) for reason in scan_content(body.encode('utf-8'), terms)]
    return problems


def archive(path, terms):
    problems = []
    with zipfile.ZipFile(path) as bundle:
        for entry in bundle.infolist():
            if entry.is_dir(): continue
            name = entry.filename.replace('\\', '/')
            inner = name.split('/', 1)[1] if '/' in name else name
            for reason in scan_path(inner, FORBIDDEN_IN_ARCHIVE): problems.append((name, reason))
            for reason in scan_content(bundle.read(entry), terms, generic=not THIRD_PARTY.search(inner)):
                problems.append((name, reason))
    return problems


def main():
    parser = argparse.ArgumentParser(description='Looks for private data in what is about to be published.')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--staged', action='store_true')
    group.add_argument('--message')
    group.add_argument('--history', action='store_true')
    group.add_argument('--zip')
    args = parser.parse_args()
    terms = private_terms()
    if args.staged: problems = staged(terms)
    elif args.message: problems = message(args.message, terms)
    elif args.history: problems = history(terms)
    else: problems = archive(args.zip, terms)
    if not problems: return 0
    out = sys.stderr
    print('Private data check: refused.', file=out)
    for where, reason in problems:
        print(f'  {where}: {reason}'.encode('ascii', 'backslashreplace').decode(), file=out)
    print('Remove these, or see tools/check_leaks.py for the rules.', file=out)
    return 1


if __name__ == '__main__':
    sys.exit(main())

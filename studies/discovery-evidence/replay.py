"""Real Unix filesystem/CLI replay. Temporary permission changes stay inside owned fixtures.

python3 -I replay.py /path/to/dist/cli.js --label baseline > results/before.json
The CLI's root is irrelevant: each subprocess gets a fresh fixture working directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

PAYLOAD = 'a\u202eb\u202c'
FORMATS = ('pretty', 'summary', 'json', 'sarif', 'github')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def put(root, name, value=PAYLOAD):
    p = root / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(value.encode() if isinstance(value, str) else value)
    return p


def git(root, *args):
    subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True)


def setup(root, kind):
    """Return cwd, arguments, expected exit, expected bytes, permission restoration."""
    cwd = root
    args = ['.', '--format', 'json']
    expected_exit = 2
    keep = {}
    restore = []
    if kind.startswith('unreadable-file-'):
        f = put(root, 'denied.txt'); f.chmod(0); restore.append((f, 0o600))
        keep['denied.txt'] = PAYLOAD.encode()
        args = ['denied.txt', '--format', kind.removeprefix('unreadable-file-')]
    elif kind == 'unreadable-directory':
        f = put(root, 'private/hidden.txt'); f.parent.chmod(0); restore.append((f.parent, 0o700))
        keep['private/hidden.txt'] = PAYLOAD.encode()
    elif kind == 'unreadable-ignore-policy':
        f = put(root, '.gitignore', 'good.txt\n'); f.chmod(0); restore.append((f, 0o600))
        put(root, 'good.txt'); keep['good.txt'] = PAYLOAD.encode(); args += ['--fix']
    elif kind in ('late-invalid-encoding', 'missing-explicit-target'):
        put(root, 'a-good.txt'); keep['a-good.txt'] = PAYLOAD.encode()
        if kind == 'late-invalid-encoding': put(root, 'z-bad.txt', b'\xff')
        args = ['a-good.txt', 'z-bad.txt', '--fix', '--format', 'json']
    elif kind in ('tracked-symlink', 'walk-symlink', 'explicit-symlink', 'explicit-directory-link', 'explicit-link-ancestor', 'tracked-link-ancestor'):
        cwd = root / 'repo'; cwd.mkdir(); outside = put(root, 'outside.txt'); keep['outside.txt'] = PAYLOAD.encode()
        put(root, 'outside/file.txt'); keep['outside/file.txt'] = PAYLOAD.encode()
        if kind == 'tracked-link-ancestor':
            put(cwd, 'tree/file.txt', 'before replacement'); git(cwd, 'init', '-q', '-b', 'main'); git(cwd, 'add', '.')
            shutil.rmtree(cwd / 'tree'); (cwd / 'tree').symlink_to('../outside', target_is_directory=True)
        else:
            (cwd / 'link.txt').symlink_to(outside)
            (cwd / 'directory').symlink_to('../outside', target_is_directory=True)
            if kind == 'tracked-symlink': git(cwd, 'init', '-q', '-b', 'main'); git(cwd, 'add', '.')
        target = {'explicit-symlink':'link.txt', 'explicit-directory-link':'directory', 'explicit-link-ancestor':'directory/file.txt'}.get(kind, '.')
        args = [target, '--fix', '--format', 'json']
        expected_exit = 2 if kind.startswith('explicit-') else 0
    elif kind == 'dangling-explicit-link':
        (root / 'broken').symlink_to('absent'); args = ['broken', '--fix', '--format', 'json']
    elif kind == 'corrupt-git-index':
        git(root, 'init', '-q', '-b', 'main'); put(root, '.git/index', 'bad index')
        put(root, 'good.txt'); keep['good.txt'] = PAYLOAD.encode(); args += ['--fix']
    elif kind == 'binary-control':
        put(root, 'binary.bin', b'\0\1\0\2'); keep['binary.bin'] = b'\0\1\0\2'; expected_exit = 0
    elif kind == 'oversized-control':
        content = b'a' * (5 * 1024 * 1024 + 1); put(root, 'large.txt', content); keep['large.txt'] = content; expected_exit = 0
    elif kind in ('regular-repair-control', 'utf16-repair-control'):
        utf16 = kind.startswith('utf16')
        value = b'\xff\xfe' + PAYLOAD.encode('utf-16le') if utf16 else PAYLOAD.encode()
        put(root, 'good.txt', value); keep['good.txt'] = b'\xff\xfea\0b\0' if utf16 else b'ab'; expected_exit = 1; args += ['--fix']
    elif kind == 'gitignore-control':
        git(root, 'init', '-q', '-b', 'main'); put(root, '.gitignore', 'ignored.txt\n'); put(root, 'ignored.txt'); put(root, 'ok.txt', 'hello')
        keep['ignored.txt'] = PAYLOAD.encode(); expected_exit = 0; args += ['--fix']
    elif kind == 'sarif-finding-control':
        put(root, 'name #100%.txt'); keep['name #100%.txt'] = PAYLOAD.encode(); args = ['.', '--format', 'sarif']; expected_exit = 1
    elif kind == 'clean-control':
        put(root, 'ok.txt', 'hello'); keep['ok.txt'] = b'hello'; expected_exit = 0
    else:
        raise ValueError(kind)
    return cwd, args, expected_exit, keep, restore


def main():
    ap = argparse.ArgumentParser(description=__doc__); ap.add_argument('cli', type=Path); ap.add_argument('--node', default='node'); ap.add_argument('--label', required=True)
    args = ap.parse_args(); cli = args.cli.resolve()
    if os.name != 'posix' or os.geteuid() == 0:
        raise SystemExit('This replay needs a non-root Unix account so chmod 000 really denies reads.')
    kinds = [f'unreadable-file-{f}' for f in FORMATS] + ['unreadable-directory','unreadable-ignore-policy','late-invalid-encoding','missing-explicit-target','tracked-symlink','walk-symlink','explicit-symlink','explicit-directory-link','explicit-link-ancestor','tracked-link-ancestor','dangling-explicit-link','corrupt-git-index','binary-control','oversized-control','regular-repair-control','utf16-repair-control','gitignore-control','sarif-finding-control','clean-control']
    records = []
    for kind in kinds:
        with tempfile.TemporaryDirectory(prefix='ghostchars-discovery-') as directory:
            root = Path(directory).resolve(); cwd, command, expected_exit, keep, restore = setup(root, kind)
            originals = {}
            try:
                # Permission-denied inputs have known fixture bytes; don't read around the failure.
                for name in keep:
                    try: originals[name] = sha((root/name).read_bytes())
                    except PermissionError: originals[name] = sha(PAYLOAD.encode())
                result = subprocess.run([args.node, str(cli), *command, '--no-config'], cwd=cwd, capture_output=True, text=True, timeout=30, env={**os.environ, 'NO_COLOR':'1'})
            finally:
                for path, mode in restore: path.chmod(mode)
            stdout = result.stdout.replace(str(root), '<fixture>'); stderr = result.stderr.replace(str(root), '<fixture>')
            try:
                report = json.loads(stdout)
                if 'summary' in report: report['summary'].pop('durationMs', None)
            except json.JSONDecodeError: report = None
            actual = {name:sha((root/name).read_bytes()) for name in keep}
            expected = {name:sha(value) for name,value in keep.items()}
            checks = {'exit': result.returncode == expected_exit, 'fileBytes': actual == expected}
            if expected_exit == 2:
                if report and 'summary' in report: checks['incompleteReport'] = report['summary'].get('complete') is False and bool(report.get('errors'))
                elif report and 'runs' in report: checks['incompleteReport'] = report['runs'][0].get('invocations', [{}])[0].get('executionSuccessful') is False
                else: checks['incompleteReport'] = ('::error ' in stdout or 'scan incomplete' in stdout) and 'no findings' not in stdout
            elif kind in ('tracked-symlink','walk-symlink','tracked-link-ancestor'):
                checks['linkExclusionRecorded'] = bool(report and report.get('skipped'))
            if kind == 'sarif-finding-control':
                checks['successfulInvocation'] = bool(report and report['runs'][0].get('invocations',[{}])[0].get('executionSuccessful'))
                checks['filenameUri'] = bool(report and report['runs'][0]['results'][0]['locations'][0]['physicalLocation']['artifactLocation']['uri'] == 'name%20%23100%25.txt')
            records.append({'case':kind,'arguments':command,'expectedExit':expected_exit,'exit':result.returncode,'checks':checks,'agrees':all(checks.values()),'originalSha256':originals,'expectedSha256':expected,'actualSha256':actual,'report':report,'stdout':None if report else stdout,'stderr':stderr})
    print(json.dumps({'label':args.label,'cliSha256':sha(cli.read_bytes()),'node':subprocess.check_output([args.node,'--version'],text=True).strip(),'platform':os.uname().sysname,'count':len(records),'disagreements':sum(not r['agrees'] for r in records),'results':records},indent=2))


if __name__ == '__main__': main()

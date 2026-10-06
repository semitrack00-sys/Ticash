"""Prepare ignored Android signing files from CI secrets; never print secrets."""
import argparse
import base64
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlsplit


def validate_config(env):
    code = env.get('RELEASE_VERSION_CODE', '')
    if not re.fullmatch(r'[1-9][0-9]*', code) or int(code) > 2100000000:
        raise ValueError('Version code must be a positive Android version code.')
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', env.get('RELEASE_VERSION_NAME', '')):
        raise ValueError('Version name must use major.minor.patch.')
    url = env.get('RELEASE_API_BASE_URL', '')
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.query or parsed.fragment
            or parsed.path != '/api' or any(c.isspace() for c in url)
            or parsed.port not in (None, 443)):
        raise ValueError('API URL must be an HTTPS origin followed by /api.')


def property_value(value):
    # java.util.Properties loads ISO-8859-1 with backslash escapes.
    result = []
    for c in value:
        if c == '\\': result.append('\\\\')
        elif c in ' :=#!': result.append('\\' + c)
        elif c == '\n': result.append('\\n')
        elif c == '\r': result.append('\\r')
        elif c == '\t': result.append('\\t')
        elif not 32 <= ord(c) < 127:
            units = c.encode('utf-16-be')
            result.extend('\\u' + units[i:i+2].hex() for i in range(0, len(units), 2))
        else: result.append(c)
    return ''.join(result)


def prepare(android_dir, env):
    validate_config(env)
    names = ['FLUPFLAP_UPLOAD_KEYSTORE_BASE64', 'FLUPFLAP_UPLOAD_KEY_ALIAS',
             'FLUPFLAP_UPLOAD_KEY_PASSWORD', 'FLUPFLAP_UPLOAD_STORE_PASSWORD']
    if any(not env.get(name) for name in names):
        raise ValueError('All four FlupFlap upload signing secrets are required.')
    try:
        data = base64.b64decode(''.join(env[names[0]].split()), validate=True)
    except ValueError:
        raise ValueError('The upload keystore secret must contain valid base64.') from None
    if not data:
        raise ValueError('The upload keystore cannot be empty.')
    android_dir = Path(android_dir).resolve()
    # Do not overwrite an independently provisioned local signing identity.
    if any((android_dir / name).exists() for name in ('upload-keystore.jks', 'key.properties')):
        raise ValueError('Signing files already exist; use a clean CI checkout.')
    with tempfile.TemporaryDirectory() as staging:
        staged_key = Path(staging) / 'upload.jks'
        staged_key.write_bytes(data)
        staged_key.chmod(0o600)
        try:
            cert = subprocess.run(
                ['keytool', '-exportcert', '-rfc', '-keystore', str(staged_key),
                 '-alias', env[names[1]], '-storepass:env', names[3]],
                env=env, capture_output=True, check=True).stdout
            cert_file = Path(staging) / 'upload.pem'
            cert_file.write_bytes(cert)
            details = subprocess.run(['keytool', '-printcert', '-file', str(cert_file)],
                                     env=env, capture_output=True, check=True).stdout
        except (subprocess.CalledProcessError, FileNotFoundError):
            raise ValueError('Cannot validate the upload keystore and alias.') from None
        if b'android debug' in details.lower():
            raise ValueError('An Android debug certificate cannot be used for release.')
        # Validate the private-key password too, without writing a second key.
        try:
            subprocess.run(['keytool', '-certreq', '-keystore', str(staged_key),
                            '-alias', env[names[1]], '-storepass:env', names[3],
                            '-keypass:env', names[2]], env=env,
                           capture_output=True, check=True)
        except subprocess.CalledProcessError:
            raise ValueError('Cannot access the upload private key.') from None
    keystore = android_dir / 'upload-keystore.jks'
    properties = android_dir / 'key.properties'
    try:
        with keystore.open('xb') as out:
            os.chmod(keystore, 0o600)
            out.write(data)
        values = {'storeFile': str(keystore), 'keyAlias': env[names[1]],
                  'keyPassword': env[names[2]], 'storePassword': env[names[3]]}
        with properties.open('x', encoding='ascii') as out:
            os.chmod(properties, 0o600)
            out.write(''.join(k + '=' + property_value(v) + '\n' for k, v in values.items()))
    except Exception:
        keystore.unlink(missing_ok=True)
        properties.unlink(missing_ok=True)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--android-dir', default='android')
    args = parser.parse_args()
    try:
        prepare(args.android_dir, dict(os.environ))
    except (ValueError, OSError) as exc:
        # OSError messages can contain a sensitive path; keep them generic.
        parser.exit(1, (str(exc) if isinstance(exc, ValueError) else 'Signing file preparation failed.') + '\n')
    print('Release configuration and upload certificate validated.')

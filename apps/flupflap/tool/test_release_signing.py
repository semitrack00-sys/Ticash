import base64
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from prepare_release_signing import prepare, property_value, validate_config


class ReleaseSigningTest(unittest.TestCase):
    def setUp(self):
        self.env = dict(os.environ, RELEASE_VERSION_CODE='6', RELEASE_VERSION_NAME='0.1.0',
                        RELEASE_API_BASE_URL='https://example.com/api')

    def test_rejects_unsafe_url_and_invalid_version(self):
        for url in ['http://example.com/api', 'https://user@example.com/api',
                    'https://example.com/api?key=secret', 'https://example.com/api#fragment',
                    'https://example.com:8080/api', 'https://example.com/nope']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_config(dict(self.env, RELEASE_API_BASE_URL=url))
        for code in ['0', '-1', '1;echo secret', '2100000001']:
            with self.subTest(code=code), self.assertRaises(ValueError):
                validate_config(dict(self.env, RELEASE_VERSION_CODE=code))

    def test_properties_escaping(self):
        self.assertEqual(property_value(' x:=#!\\\n\r\t é'),
                         r'\ x\:\=\#\!\\\n\r\t\ \u00e9')

    def make_key(self, directory, subject):
        path = Path(directory) / 'source.jks'
        env = dict(self.env, FLUPFLAP_UPLOAD_STORE_PASSWORD='test:store password!',
                   FLUPFLAP_UPLOAD_KEY_PASSWORD='test:key password!', FLUPFLAP_UPLOAD_KEY_ALIAS='upload')
        subprocess.run(['keytool', '-genkeypair', '-keystore', str(path), '-storetype', 'JKS',
                        '-alias', 'upload', '-dname', subject, '-keyalg', 'RSA', '-keysize', '2048',
                        '-validity', '2', '-storepass:env', 'FLUPFLAP_UPLOAD_STORE_PASSWORD',
                        '-keypass:env', 'FLUPFLAP_UPLOAD_KEY_PASSWORD'],
                       env=env, check=True, capture_output=True)
        env['FLUPFLAP_UPLOAD_KEYSTORE_BASE64'] = base64.b64encode(path.read_bytes()).decode()
        return env

    def test_real_upload_key_preparation_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.make_key(directory, 'CN=FlupFlap Upload Test')
            android = Path(directory) / 'android'
            android.mkdir()
            prepare(android, env)
            self.assertEqual((android / 'key.properties').stat().st_mode & 0o777, 0o600)
            original = (android / 'upload-keystore.jks').read_bytes()
            with self.assertRaises(ValueError): prepare(android, env)
            self.assertEqual((android / 'upload-keystore.jks').read_bytes(), original)

    def test_rejects_debug_and_bad_credentials_without_output_files(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.make_key(directory, 'CN=Android Debug,O=Android,C=US')
            android = Path(directory) / 'android'
            android.mkdir()
            with self.assertRaises(ValueError): prepare(android, env)
            self.assertEqual(list(android.iterdir()), [])
            with self.assertRaises(ValueError):
                prepare(android, dict(env, FLUPFLAP_UPLOAD_STORE_PASSWORD='wrong-password'))
            self.assertEqual(list(android.iterdir()), [])


if __name__ == '__main__':
    unittest.main()

import unittest
from check_android_manifest import check_manifest, FORBIDDEN

BASE = '''<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.ticash.flupflap">
<uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36"/>
<uses-permission android:name="android.permission.INTERNET"/>
<application android:debuggable="false" android:allowBackup="false" android:usesCleartextTraffic="false"/>
</manifest>'''


class BuiltManifestTest(unittest.TestCase):
    def test_release_and_explicit_qa_mode(self):
        self.assertTrue(check_manifest(BASE))
        qa = BASE.replace('debuggable="false"', 'debuggable="true"')
        with self.assertRaises(ValueError): check_manifest(qa)
        self.assertTrue(check_manifest(qa, allow_debug=True))

    def test_plugin_permission_injections(self):
        for permission in FORBIDDEN:
            for tag in ['uses-permission', 'uses-permission-sdk-23']:
                manifest = BASE.replace('</manifest>', f'<{tag} android:name="{permission}"/></manifest>')
                with self.subTest(permission=permission, tag=tag), self.assertRaises(ValueError):
                    check_manifest(manifest, allow_debug=True)

    def test_identity_api_and_security_controls(self):
        for old, new in [('com.ticash.flupflap', 'com.ticash.mobile'), ('targetSdkVersion="36"', 'targetSdkVersion="34"'),
                         ('allowBackup="false"', 'allowBackup="true"'), ('usesCleartextTraffic="false"', 'usesCleartextTraffic="true"')]:
            with self.subTest(old=old), self.assertRaises(ValueError): check_manifest(BASE.replace(old, new))

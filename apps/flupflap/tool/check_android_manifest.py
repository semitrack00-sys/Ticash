"""Check a decoded *built* APK manifest, supplied by Android SDK apkanalyzer."""
import argparse
import sys
import xml.etree.ElementTree as ET

ANDROID = '{http://schemas.android.com/apk/res/android}'
FORBIDDEN = {'android.permission.CAMERA', 'android.permission.RECORD_AUDIO',
             'android.permission.VIBRATE', 'android.permission.READ_CONTACTS',
             'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'}


def check_manifest(text, allow_debug=False):
    root = ET.fromstring(text)
    if root.tag != 'manifest' or root.get('package') != 'com.ticash.flupflap':
        raise ValueError('Unexpected application identity')
    sdk = root.find('uses-sdk')
    if sdk is None or int(sdk.get(ANDROID + 'targetSdkVersion', '0')) < 36:
        raise ValueError('API 36 required')
    application = root.find('application')
    if application is None:
        raise ValueError('Application missing')
    if not allow_debug and application.get(ANDROID + 'debuggable', 'false') != 'false':
        raise ValueError('Debuggable release rejected')
    if application.get(ANDROID + 'allowBackup') != 'false' or application.get(ANDROID + 'usesCleartextTraffic') != 'false':
        raise ValueError('Backup/transport policy mismatch')
    for element in root:
        if element.tag.startswith('uses-permission') and element.get(ANDROID + 'name') in FORBIDDEN:
            raise ValueError('Unexpected recharge permission')
    return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--allow-debug-qa', action='store_true')
    args = parser.parse_args()
    check_manifest(sys.stdin.read(), args.allow_debug_qa)
    print('Built FlupFlap manifest checks passed')

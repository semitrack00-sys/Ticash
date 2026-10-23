import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[3]


class RechargeDependencyBoundaryTest(unittest.TestCase):
    def test_flupflap_uses_recharge_core_without_whole_ticash_app(self):
        pubspec = (ROOT / 'apps/flupflap/pubspec.yaml').read_text()
        self.assertIn('path: ../recharge_core', pubspec)
        self.assertNotRegex(pubspec, r'(?m)^  ticash:')
        core = ROOT / 'apps/recharge_core'
        self.assertNotIn('didit', (core / 'pubspec.yaml').read_text().lower())
        for source in (core / 'lib').rglob('*.dart'):
            self.assertNotIn('package:ticash/', source.read_text())
            self.assertNotIn('package:didit', source.read_text())
            for relative in re.findall(r"(?:import|export) '([^:']+)'", source.read_text()):
                self.assertTrue((source.parent / relative).is_file(), relative)

    def test_ticash_retains_identity_verification(self):
        pubspec = (ROOT / 'apps/mobile/pubspec.yaml').read_text()
        self.assertIn('didit_sdk_autodetection:', pubspec)
        screen = ROOT / 'apps/mobile/lib/screens/kyc/kyc_onboarding_screen.dart'
        self.assertIn('package:didit_sdk_autodetection/', screen.read_text())


if __name__ == '__main__':
    unittest.main()

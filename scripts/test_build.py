"""Release boundary checks for the standard-library package builder."""
import json
import re
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

import build


class ReleasePackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package = build.check_sources()
        cls.members = build.package_members(cls.package)[f"{cls.package['name']}-{cls.package['version']}.vsix"]

    def test_marketplace_assets_exist_and_identity_matches(self):
        manifest = ET.fromstring(self.members['extension.vsixmanifest'])
        ns = {'v': 'http://schemas.microsoft.com/developer/vsx-schema/2011'}
        identity = manifest.find('v:Metadata/v:Identity', ns)
        self.assertEqual(identity.attrib['Id'], build.SKILL_NAME)
        self.assertEqual(self.package['displayName'], 'Live Share Workspace Bridge')
        self.assertEqual(identity.attrib['Publisher'], self.package['publisher'])
        self.assertEqual(identity.attrib['Version'], self.package['version'])
        assets = manifest.findall('v:Assets/v:Asset', ns)
        self.assertEqual(len(assets), 4)
        for asset in assets:
            self.assertIn(asset.attrib['Path'], self.members)
        self.assertEqual(json.loads(self.members['extension/package.json']), self.package)

    def test_unrelated_documents_are_not_published(self):
        # A new audit in docs/ must never silently expand the published package.
        with patch.object(build.Path, 'glob', side_effect=AssertionError('No directory-wide packaging')):
            rebuilt = build.package_members(self.package)
        self.assertEqual(next(iter(rebuilt.values())), self.members)
        self.assertFalse(any('INVESTIGATION' in name or '.local' in name or '/test/' in name for name in self.members))
        self.assertEqual(sum(name.startswith('extension/docs/') for name in self.members), 24)

    def test_reader_links_resolve_on_marketplace(self):
        repository = 'https://github.com/Koha9/liveshare-workspace-bridge'
        result = build.marketplace_markdown('[Guide](../docs/USAGE.md) [Local](README.ja.md) [Web](https://example.org) [Part](#part)', 'extension/README.md', repository)
        self.assertIn(f']({repository}/blob/main/docs/USAGE.md)', result)
        self.assertIn(f']({repository}/blob/main/extension/README.ja.md)', result)
        self.assertIn('[Web](https://example.org) [Part](#part)', result)
        for name, data in self.members.items():
            if name.endswith('.md'):
                self.assertNotRegex(data.decode('utf-8'), r'\]\((?!https?://|#)[^\s)]+\)')
                for target in re.findall(r'\]\(' + re.escape(repository) + r'/blob/main/([^\s)]+)\)', data.decode('utf-8')):
                    self.assertTrue((build.ROOT / target.split('#')[0]).is_file(), f'{name}: missing linked source {target}')


if __name__ == '__main__':
    unittest.main()

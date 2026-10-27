"""Build and verify the local VSIX and Codex skill with Python's standard library."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import posixpath
import re
from urllib.parse import urlsplit
import zipfile
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
EXTENSION = ROOT / "extension"
SKILL_NAME = "liveshare-workspace-bridge"
SKILL = ROOT / "skills" / SKILL_NAME
DIST = ROOT / "dist"
RUNTIME_FILES = ("extension.cjs", "workspace.cjs", "core.cjs", "cli.cjs", "pipe-host.ps1", "pipe-security.cs", "local-accounts.cs", "ipc-access.cjs", "startup-diagnostics.cjs", "permissions.cjs", "host-channel.cjs", "host-operations.cjs", "patch.cjs", "host-runtime.cs", "host-actions.ps1")
DOCUMENT_NAMES = ("README", "USAGE", "API", "ARCHITECTURE", "DEVELOPMENT", "TROUBLESHOOTING", "IPC-SECURITY", "STARTUP-DIAGNOSTICS", "CHANGELOG", "SETTINGS")
LOCALES = ("", ".zh-CN", ".zh-TW", ".ja")
SKILL_FILES = (
    "SKILL.md", "agents/openai.yaml", "references/api.md", "references/recovery.md",
    "scripts/liveshare.cjs",
)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def check_sources() -> dict:
    package = read_json(EXTENSION / "package.json")
    root_package = read_json(ROOT / "package.json")
    if root_package["name"] != SKILL_NAME or package["name"] != SKILL_NAME:
        raise ValueError("Root, extension and skill must all be named liveshare-workspace-bridge.")
    if root_package["version"] != package["version"]:
        raise ValueError("Root and extension package versions differ.")
    if root_package["license"] != package["license"]:
        raise ValueError("Root and extension package licenses differ.")
    if not (ROOT / "LICENSE").is_file():
        raise ValueError("Missing repository LICENSE file.")
    for name in (*RUNTIME_FILES, "README.md"):
        if not (EXTENSION / name).is_file():
            raise ValueError(f"Missing extension file: {name}")
    for name in SKILL_FILES:
        if not (SKILL / name).is_file():
            raise ValueError(f"Missing skill file: {name}")
    skill_text = (SKILL / "SKILL.md").read_text(encoding="utf-8-sig")
    if not skill_text.startswith("---\n"):
        raise ValueError("Skill YAML frontmatter is missing.")
    frontmatter = skill_text.split("---", 2)[1]
    if not re.search(rf"^name: {re.escape(SKILL_NAME)}$", frontmatter, re.MULTILINE):
        raise ValueError("Unexpected skill name.")
    if not re.search(r"^description: .+", frontmatter, re.MULTILINE):
        raise ValueError("Skill description is missing.")
    version = re.search(r'^  version: "([^"]+)"$', frontmatter, re.MULTILINE)
    if not version or version.group(1) != package["version"]:
        raise ValueError("Skill and extension versions differ.")
    if (EXTENSION / "cli.cjs").read_bytes() != (SKILL / "scripts/liveshare.cjs").read_bytes():
        raise ValueError("Skill client is out of sync. Run scripts/build.py without --check to synchronize it.")
    return package


def marketplace_markdown(text: str, source: str, repository: str) -> str:
    """Resolve repository-relative reader links for the Marketplace renderer."""
    def replace(match: re.Match) -> str:
        target = match.group(2)
        if urlsplit(target).scheme or target.startswith(("#", "/")):
            return match.group(0)
        relative = posixpath.normpath(posixpath.join(posixpath.dirname(source), target))
        return f"{match.group(1)}{repository}/blob/main/{relative}{match.group(3)}"
    return re.sub(r"(\]\()([^\s)]+)(\))", replace, text)


def package_members(package: dict) -> dict[str, dict[str, bytes]]:
    identity = {key: escape(package[key], {'"': "&quot;"}) for key in ("name", "version", "publisher")}
    repository = package["repository"]["url"].removesuffix(".git")
    properties = {
        "Microsoft.VisualStudio.Code.Engine": package["engines"]["vscode"],
        "Microsoft.VisualStudio.Code.ExtensionKind": ",".join(package["extensionKind"]),
        "Microsoft.VisualStudio.Code.ExecutesCode": "true",
        "Microsoft.VisualStudio.Services.Links.Source": repository,
        "Microsoft.VisualStudio.Services.Links.GitHub": repository,
        "Microsoft.VisualStudio.Services.Links.Support": package["bugs"]["url"],
        "Microsoft.VisualStudio.Services.Links.Learn": package["homepage"],
        "Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown": "true",
        "Microsoft.VisualStudio.Services.Content.Pricing": "Free",
    }
    property_xml = "".join(f'<Property Id="{key}" Value="{escape(value, {chr(34): "&quot;"})}"/>' for key, value in properties.items())
    assets = {
        "Microsoft.VisualStudio.Code.Manifest": "extension/package.json",
        "Microsoft.VisualStudio.Services.Content.Details": "extension/README.md",
        "Microsoft.VisualStudio.Services.Content.License": "extension/LICENSE.txt",
        "Microsoft.VisualStudio.Services.Icons.Default": f"extension/{package['icon']}",
    }
    asset_xml = "".join(f'<Asset Type="{key}" Path="{value}" Addressable="true"/>' for key, value in assets.items())
    manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
 <Metadata><Identity Language="en-US" Id="{identity['name']}" Version="{identity['version']}" Publisher="{identity['publisher']}"/>
 <DisplayName>{escape(package['displayName'])}</DisplayName><Description xml:space="preserve">{escape(package['description'])}</Description>
 <Tags>{escape(','.join(package['keywords']))}</Tags><Categories>{escape(','.join(package['categories']))}</Categories><GalleryFlags>Public</GalleryFlags>
 <Properties>{property_xml}</Properties><License>extension/LICENSE.txt</License><Icon>extension/{package['icon']}</Icon></Metadata>
 <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
 <Assets>{asset_xml}</Assets>
</PackageManifest>'''
    content_types = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/>
 <Default Extension="ps1" ContentType="text/plain"/><Default Extension="cs" ContentType="text/plain"/><Default Extension="md" ContentType="text/markdown"/>
 <Default Extension="txt" ContentType="text/plain"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="vsixmanifest" ContentType="text/xml"/>
</Types>'''
    extension_members = {f"extension/{name}": (EXTENSION / name).read_bytes() for name in (*RUNTIME_FILES, "package.json")}
    extension_members["extension/LICENSE.txt"] = (ROOT / "LICENSE").read_bytes()
    if icon_name := package.get("icon"):
        icon_path = (EXTENSION / icon_name).resolve()
        if not icon_path.is_relative_to(EXTENSION.resolve()) or not icon_path.is_file():
            raise ValueError("Icon must be an existing file inside extension/.")
        extension_members[f"extension/{Path(icon_name).as_posix()}"] = icon_path.read_bytes()
    # Ship language navigation and reader documentation without repository-relative links.
    for suffix in LOCALES:
        name = f"README{suffix}.md"
        readme = marketplace_markdown((EXTENSION / name).read_text(encoding="utf-8"), f"extension/{name}", repository)
        extension_members[f"extension/{name}"] = readme.encode("utf-8")
    # Publish reader documentation only; investigations and local evidence are not release assets.
    for stem in DOCUMENT_NAMES:
        for suffix in LOCALES:
            name = f"{stem}{suffix}.md"
            document = ROOT / "docs" / name
            extension_members[f"extension/docs/{name}"] = marketplace_markdown(document.read_text(encoding="utf-8"), f"docs/{name}", repository).encode("utf-8")
    extension_members.update({
        "extension.vsixmanifest": manifest.encode("utf-8"),
        "[Content_Types].xml": content_types.encode("utf-8"),
    })
    skill_members = {f"{SKILL_NAME}/{name}": (SKILL / name).read_bytes() for name in SKILL_FILES}
    skill_members[f"{SKILL_NAME}/LICENSE"] = (ROOT / "LICENSE").read_bytes()
    return {
        f"{package['name']}-{package['version']}.vsix": extension_members,
        f"{SKILL_NAME}-{package['version']}.zip": skill_members,
    }


def build(packages: dict[str, dict[str, bytes]]) -> None:
    DIST.mkdir(exist_ok=True)
    for name, members in packages.items():
        destination = DIST / name
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for member, data in sorted(members.items()):
                info = zipfile.ZipInfo(member, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, data)
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        destination.with_suffix(destination.suffix + ".sha256").write_text(f"{digest}  {name}\n", encoding="utf-8")
        print(f"Built dist/{name}")


def verify(packages: dict[str, dict[str, bytes]]) -> None:
    for name, expected in packages.items():
        artifact = DIST / name
        with zipfile.ZipFile(artifact) as archive:
            if archive.testzip() is not None or set(archive.namelist()) != set(expected):
                raise ValueError(f"Unexpected or corrupt package members: {name}")
            for member, data in expected.items():
                if archive.read(member) != data:
                    raise ValueError(f"Package/source mismatch: {name}:{member}")
        digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
        if artifact.with_suffix(artifact.suffix + ".sha256").read_text(encoding="utf-8") != f"{digest}  {name}\n":
            raise ValueError(f"Checksum mismatch: {name}")
        print(f"Verified dist/{name}: exact source members and SHA-256")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--check", action="store_true", help="Check source layout, versions and skill-client synchronization without writes.")
    modes.add_argument("--verify", action="store_true", help="Verify existing packages against source and SHA-256 without writes.")
    args = parser.parse_args()
    if not args.check and not args.verify:
        (SKILL / "scripts/liveshare.cjs").write_bytes((EXTENSION / "cli.cjs").read_bytes())
    package = check_sources()
    if args.check:
        print(f"Source checks passed for v{package['version']}; skill client is synchronized.")
        return
    packages = package_members(package)
    if not args.verify:
        build(packages)
    verify(packages)


if __name__ == "__main__":
    main()

"""Build an installable VSIX when npm and vsce are unavailable locally."""

from pathlib import Path
import json
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED


ROOT = Path(__file__).resolve().parents[1]
package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
output = ROOT / f"{package['name']}-{package['version']}.vsix"

if not (ROOT / "out" / "extension.js").is_file():
    raise SystemExit("Сначала скомпилируйте исходный код в out/extension.js")

namespace = "http://schemas.microsoft.com/developer/vsx-schema/2011"
ET.register_namespace("", namespace)


def element(parent, tag, attributes=None, text=None):
    child = ET.SubElement(parent, f"{{{namespace}}}{tag}", attributes or {})
    if text is not None:
        child.text = text
    return child


manifest = ET.Element(f"{{{namespace}}}PackageManifest", {"Version": "2.0.0"})
metadata = element(manifest, "Metadata")
element(metadata, "Identity", {
    "Id": package["name"],
    "Version": package["version"],
    "Publisher": package["publisher"],
    "Language": "ru-RU",
})
element(metadata, "DisplayName", text=package["displayName"])
element(metadata, "Description", text=package["description"])
element(metadata, "Categories", text=",".join(package["categories"]))
element(metadata, "GalleryFlags", text="Public")
properties = element(metadata, "Properties")
element(properties, "Property", {
    "Id": "Microsoft.VisualStudio.Code.Engine",
    "Value": package["engines"]["vscode"],
})
element(properties, "Property", {
    "Id": "Microsoft.VisualStudio.Code.ExecutesCode",
    "Value": "true",
})
element(metadata, "License", text="extension/LICENSE.txt")
installation = element(manifest, "Installation")
element(installation, "InstallationTarget", {"Id": "Microsoft.VisualStudio.Code"})
element(manifest, "Dependencies")
assets = element(manifest, "Assets")
for asset_type, asset_path in [
    ("Microsoft.VisualStudio.Code.Manifest", "extension/package.json"),
    ("Microsoft.VisualStudio.Services.Content.Details", "extension/README.md"),
    ("Microsoft.VisualStudio.Services.Content.License", "extension/LICENSE.txt"),
]:
    element(assets, "Asset", {"Type": asset_type, "Path": asset_path, "Addressable": "true"})

content_types = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="txt" ContentType="text/plain" />
</Types>
"""

with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    archive.writestr("[Content_Types].xml", content_types)
    archive.writestr("extension.vsixmanifest", ET.tostring(manifest, encoding="utf-8", xml_declaration=True))
    archive.write(ROOT / "package.json", "extension/package.json")
    archive.write(ROOT / "README.md", "extension/README.md")
    archive.write(ROOT / "LICENSE", "extension/LICENSE.txt")
    for file in sorted((ROOT / "docs").rglob("*.md")):
        archive.write(file, f"extension/{file.relative_to(ROOT).as_posix()}")
    for file in sorted((ROOT / "out").glob("*.js")):
        archive.write(file, f"extension/out/{file.name}")

print(output)

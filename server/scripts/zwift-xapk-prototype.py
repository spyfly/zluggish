"""Package a user-supplied Zwift APKM and a matching, already patched OBB as an XAPK."""

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

PACKAGE = "com.zwift.zwiftgame"
APK_NAME = re.compile(r"[\w.-]+\.apk", re.ASCII)


def apk_metadata(aapt, path):
    output = subprocess.run(
        [aapt, "dump", "badging", str(path)], check=True, capture_output=True, text=True
    ).stdout
    line = next((line for line in output.splitlines() if line.startswith("package: ")), "")
    return dict(re.findall(r"(\w+)='([^']*)'", line))


def build(source, obb, output, aapt):
    if output.suffix.lower() != ".xapk":
        raise ValueError("Use an .xapk extension for the output.")

    with zipfile.ZipFile(source) as bundle, tempfile.TemporaryDirectory() as temp:
        apks = [entry for entry in bundle.infolist() if APK_NAME.fullmatch(entry.filename)]
        apks.sort(key=lambda entry: (entry.filename != "base.apk", entry.filename))
        if not apks or apks[0].filename != "base.apk" or len({e.filename for e in apks}) != len(apks):
            raise ValueError("The APKM needs one base.apk and uniquely named splits.")

        splits = []
        version = None
        split_ids = {"base"}
        for entry in apks:
            local = Path(temp, "inspect.apk")
            with bundle.open(entry) as original, local.open("wb") as copy:
                shutil.copyfileobj(original, copy)
            metadata = apk_metadata(aapt, local)

            if entry.filename == "base.apk":
                version = metadata.get("versionCode", "")
                version_name = metadata.get("versionName")
                if not re.fullmatch(r"[0-9]{1,12}", version) or not version_name or metadata.get("split"):
                    raise ValueError("The base APK must declare a Zwift version.")
                splits.append({"id": "base", "file": f"{PACKAGE}.apk"})
            else:
                split = metadata.get("split")
                if not split or split in split_ids or entry.filename == f"{PACKAGE}.apk":
                    raise ValueError(f"Invalid split metadata in {entry.filename}.")
                split_ids.add(split)
                splits.append({"id": split, "file": entry.filename})

            if metadata.get("name") != PACKAGE or metadata.get("versionCode") != version:
                raise ValueError(f"{entry.filename} does not match the Zwift base APK.")

        expected = f"main.{version}.{PACKAGE}.obb"
        if obb.name != expected:
            raise ValueError(f"Use the patched expansion file named {expected}.")

        originals = [entry for entry in bundle.infolist() if Path(entry.filename).name == expected]
        if len(originals) != 1 or originals[0].file_size != obb.stat().st_size:
            raise ValueError("The patched OBB must match the original expansion file's name and size.")

        install_path = f"Android/obb/{PACKAGE}/{expected}"
        manifest = {
            "xapk_version": 2,
            "name": "Zwift",
            "package_name": PACKAGE,
            "version_code": version,
            "version_name": version_name,
            "total_size": sum(entry.file_size for entry in apks) + obb.stat().st_size,
            "split_apks": splits,
            "expansions": [
                {"file": install_path, "install_location": "EXTERNAL_STORAGE", "install_path": install_path}
            ],
        }

        # The ZIP container is new. Every inner APK is copied byte-for-byte.
        with output.open("xb") as file:
            try:
                with zipfile.ZipFile(file, "w", allowZip64=False) as xapk:
                    xapk.write(obb, install_path)
                    for entry, split in zip(apks, splits, strict=True):
                        with bundle.open(entry) as original, xapk.open(split["file"], "w") as copy:
                            shutil.copyfileobj(original, copy)
                    if "icon.png" in bundle.namelist():
                        manifest["icon"] = "icon.png"
                        with bundle.open("icon.png") as original, xapk.open("icon.png", "w") as copy:
                            shutil.copyfileobj(original, copy)
                    xapk.writestr("manifest.json", json.dumps(manifest))
            except Exception:
                file.close()
                output.unlink()
                raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_apkm", type=Path)
    parser.add_argument("patched_obb", type=Path)
    parser.add_argument("output_xapk", type=Path)
    parser.add_argument("--aapt", default="aapt", help="Path to aapt from Android SDK build-tools")
    args = parser.parse_args()
    try:
        build(args.source_apkm, args.patched_obb, args.output_xapk, args.aapt)
    except (ValueError, OSError, zipfile.BadZipFile, zipfile.LargeZipFile, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()

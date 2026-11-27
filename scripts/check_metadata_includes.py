#!/usr/bin/env python3
"""Check that Hasura table/function include lists exactly match their folders."""

import re
import sys
from pathlib import Path


METADATA_ROOT = Path("metadata/tenants")
INDEX_NAMES = {"tables.yaml", "functions.yaml"}
INCLUDE_PATTERN = re.compile(
    r"^\s*-\s*(?:\"!include\s+([^\"]+)\"|'!include\s+([^']+)'|!include\s+(\S+))\s*$",
    re.MULTILINE,
)


def check_index(index_path: Path) -> list[str]:
    errors = []
    content = index_path.read_text(encoding="utf-8")
    includes = [next(group for group in match if group) for match in INCLUDE_PATTERN.findall(content)]

    if len(includes) != len(set(includes)):
        errors.append(f"{index_path}: duplicate !include entries")

    directory = index_path.parent
    included_paths = set()
    for include in includes:
        included_path = (directory / include).resolve()
        try:
            included_path.relative_to(directory.resolve())
        except ValueError:
            errors.append(f"{index_path}: !include escapes its metadata folder: {include}")
            continue

        if not included_path.is_file():
            errors.append(f"{index_path}: missing included file: {include}")
        included_paths.add(included_path)

    for metadata_file in sorted(directory.rglob("*")):
        if not metadata_file.is_file() or metadata_file.suffix not in {".yaml", ".yml"}:
            continue
        if metadata_file.name in INDEX_NAMES and metadata_file.parent == directory:
            continue
        if metadata_file.resolve() not in included_paths:
            errors.append(
                f"{index_path}: file is not included: "
                f"{metadata_file.relative_to(directory).as_posix()}"
            )

    return errors


def main() -> int:
    errors = []
    for database_dir in sorted(METADATA_ROOT.glob("*/databases")):
        for index_name in sorted(INDEX_NAMES):
            for index_path in sorted(database_dir.rglob(index_name)):
                errors.extend(check_index(index_path))

    if errors:
        print("Metadata include validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Metadata table/function include lists match their folders.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

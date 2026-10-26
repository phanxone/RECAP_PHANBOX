"""Idempotently sync finalized recap folders to Supabase Storage and Database."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import quote

import requests

BASE = Path(__file__).resolve().parent
FINAL = BASE / "final"


def configuration() -> tuple[str, str, str]:
    values = {}
    for line in (BASE / ".env").read_text(encoding="utf-8-sig").splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            values[name.strip()] = value.strip().strip('"').strip("'")
    url = values.get("SUPABASE_URL", "").rstrip("/")
    key = values.get("SUPABASE_KEY", "")
    bucket = values.get("SUPABASE_BUCKET", "recaps") or "recaps"
    if not url.startswith("https://") or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_KEY is missing from .env")
    return url, key, bucket


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def public_url(base: str, bucket: str, object_path: str) -> str:
    return (f"{base}/storage/v1/object/public/{quote(bucket, safe='')}/"
            f"{quote(object_path, safe='/')}")


def upload(session: requests.Session, base: str, bucket: str, path: Path,
           object_path: str, media_type: str) -> str:
    endpoint = (f"{base}/storage/v1/object/{quote(bucket, safe='')}/"
                f"{quote(object_path, safe='/')}")
    headers = {"Content-Type": media_type}
    with path.open("rb") as content:
        response = session.post(endpoint, data=content, headers=headers, timeout=180)
    if response.status_code not in (200, 201) and "AccessDenied" in response.text:
        public = public_url(base, bucket, object_path)
        exists = session.get(public, headers={"Range": "bytes=0-0"},
                             stream=True, timeout=30)
        exists.close()
        if exists.status_code in (200, 206):
            return public
    if response.status_code not in (200, 201):
        raise RuntimeError(f"Storage upload of {path.name} returned "
                           f"HTTP {response.status_code}: {response.text[:200]}")
    return public_url(base, bucket, object_path)


def sync_folder(session: requests.Session, base: str, bucket: str,
                folder: Path) -> None:
    info_path = folder / "info.json"
    data = json.loads(info_path.read_text(encoding="utf-8-sig"))
    previous = json.dumps(data, ensure_ascii=False, sort_keys=True)
    hashes = dict(data.get("storage_sha256") or {})
    data["folder"] = folder.name
    media = [
        ("video_file", "cloud_video_url", "video/mp4", True),
        ("thumbnail_file", "cloud_thumbnail_url", "image/jpeg", True),
        ("subtitle_file", "cloud_subtitle_url", "text/plain; charset=utf-8", False),
        ("post_file", "cloud_post_url", "text/plain; charset=utf-8", False),
    ]
    for filename_key, url_key, media_type, required in media:
        filename = data.get(filename_key)
        if not filename:
            if required:
                raise RuntimeError(f"{folder.name}: missing {filename_key}")
            continue
        path = folder / filename
        if not path.is_file():
            raise RuntimeError(f"{folder.name}: {filename} is missing")
        object_path = f"{folder.name}/{filename}"
        expected = public_url(base, bucket, object_path)
        current_hash = digest(path)
        prior_url = data.get(url_key)
        prior_hash = hashes.get(filename)
        changed_content = bool(prior_hash and prior_hash != current_hash)
        if changed_content:
            # This project's anon Storage policy permits new objects but not
            # replacing existing ones. New content gets a versioned key.
            stem, extension = path.stem, path.suffix
            object_path = f"{folder.name}/{stem}.{current_hash[:12]}{extension}"
            expected = public_url(base, bucket, object_path)
        if prior_url != expected or changed_content:
            data[url_key] = upload(session, base, bucket, path,
                                   object_path, media_type)
            print(f"Uploaded {folder.name}/{filename}")
        hashes[filename] = current_hash

    data["storage_sha256"] = hashes
    metadata_for_hash = {key: value for key, value in data.items()
                         if key not in ("storage_sha256", "cloud_info_url",
                                        "info_content_hash")}
    info_hash = hashlib.sha256(json.dumps(metadata_for_hash, ensure_ascii=False,
                                          sort_keys=True).encode("utf-8")).hexdigest()
    old_info_hash = data.get("info_content_hash")
    old_info_url = data.get("cloud_info_url")
    info_key = f"{folder.name}/info.json"
    if old_info_hash and old_info_hash != info_hash:
        info_key = f"{folder.name}/info.{info_hash[:12]}.json"
    data["info_content_hash"] = info_hash
    data["cloud_info_url"] = public_url(base, bucket, info_key)
    if json.dumps(data, ensure_ascii=False, sort_keys=True) != previous:
        info_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                             encoding="utf-8")
    if not old_info_url or old_info_url != data["cloud_info_url"]:
        upload(session, base, bucket, info_path, info_key, "application/json")

    payload = {
        "id": data["id"], "title": data["title"],
        "titles": data.get("titles", []),
        "description": data.get("description", ""),
        "video_url": data["cloud_video_url"],
        "thumbnail_url": data["cloud_thumbnail_url"],
        "folder_name": folder.name,
        "series": data.get("series", ""),
        "duration": data.get("duration", ""),
        "tags": data.get("tags", []),
        "created_at": data.get("created_at"),
    }
    endpoint = f"{base}/rest/v1/recaps"
    result = session.post(endpoint, json=payload,
                          headers={"Prefer": "resolution=merge-duplicates,return=representation"},
                          timeout=30)
    if result.status_code not in (200, 201):
        raise RuntimeError(f"Database sync of {folder.name} returned "
                           f"HTTP {result.status_code}: {result.text[:200]}")
    check = session.get(endpoint,
                        params={"id": f"eq.{data['id']}",
                                "select": "id,folder_name,video_url,thumbnail_url"},
                        timeout=30)
    if check.status_code != 200 or not check.json() or \
       check.json()[0]["folder_name"] != folder.name or \
       check.json()[0]["video_url"] != data["cloud_video_url"]:
        raise RuntimeError(f"Database verification failed for {folder.name}")

    print(f"Synced {folder.name} to Supabase (id={data['id']})")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder", help="Sync one folder in final/; omit for all")
    args = parser.parse_args(argv)
    base, key, bucket = configuration()
    session = requests.Session()
    session.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})
    if args.folder:
        folder = (FINAL / args.folder).resolve()
        if folder.parent != FINAL.resolve() or not folder.is_dir():
            raise RuntimeError("Requested folder is outside final/ or missing")
        folders = [folder]
    else:
        folders = sorted(path.parent for path in FINAL.glob("*/info.json"))
    failures = 0
    for folder in folders:
        try:
            sync_folder(session, base, bucket, folder)
        except Exception as exc:
            failures += 1
            print(f"FAILED {folder.name}: {exc}", file=sys.stderr)
    print(f"Supabase sync: {len(folders)-failures}/{len(folders)} folders")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

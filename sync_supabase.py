import os
import sys
import json
import requests

# Reconfigure stdout to utf-8 to prevent charmap errors on Windows terminals
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

ENV_FILE = "C:/71006/phanbox/.env"
FINAL_DIR = "C:/71006/phanbox/final"

def load_env():
    env = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    val = v.strip().strip('"').strip("'")
                    env[k.strip()] = val
                    os.environ[k.strip()] = val
    return env

def get_config():
    env = load_env()
    url = env.get("SUPABASE_URL", "").strip().rstrip("/")
    key = env.get("SUPABASE_KEY", "").strip()
    bucket = env.get("SUPABASE_BUCKET", "recaps").strip() or "recaps"
    return url, key, bucket

def ensure_storage_bucket(url, key, bucket="recaps"):
    """Check if bucket exists or can be created."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }
    try:
        res = requests.get(f"{url}/storage/v1/bucket/{bucket}", headers=headers, timeout=10)
        if res.status_code == 200:
            print(f"[Supabase Storage] Bucket '{bucket}' is ready!")
            return True
        create_res = requests.post(
            f"{url}/storage/v1/bucket",
            headers=headers,
            json={"id": bucket, "name": bucket, "public": True},
            timeout=10
        )
        if create_res.status_code in (200, 201):
            print(f"[Supabase Storage] Created public bucket '{bucket}'!")
            return True
        else:
            print(f"[Supabase Storage] Notice: bucket '{bucket}' not ready ({create_res.status_code}). Run setup SQL if needed.")
    except Exception as e:
        print(f"[Supabase Storage] Notice on bucket check: {e}")
    return False

def upload_file_to_storage(url, key, bucket, file_path, storage_path, content_type):
    """Upload binary file to Supabase Storage bucket and return public URL."""
    if not os.path.exists(file_path):
        return None

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": content_type,
        "x-upsert": "true"
    }
    upload_url = f"{url}/storage/v1/object/{bucket}/{storage_path}"
    try:
        with open(file_path, "rb") as f:
            data = f.read()
        res = requests.post(upload_url, headers=headers, data=data, timeout=60)
        if res.status_code in (200, 201):
            public_url = f"{url}/storage/v1/object/public/{bucket}/{storage_path}"
            return public_url
        else:
            print(f"[Storage Upload] {storage_path}: HTTP {res.status_code} - {res.text[:100]}")
    except Exception as e:
        print(f"[Storage Upload Error] {storage_path}: {e}")
    return None

def sync():
    url, key, bucket = get_config()
    if not url or not key:
        print("[Supabase Sync] Warning: SUPABASE_URL or SUPABASE_KEY is missing in .env file.")
        print("[Supabase Sync] Please update C:/71006/phanbox/.env with your credentials.")
        return False

    print(f"[Supabase Sync] Connecting to {url} (Bucket: {bucket})...")
    bucket_ready = ensure_storage_bucket(url, key, bucket)

    folders = [f for f in os.listdir(FINAL_DIR) if os.path.isdir(os.path.join(FINAL_DIR, f))]
    synced_count = 0

    rest_endpoint = f"{url}/rest/v1/recaps"
    db_headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }

    for folder in sorted(folders):
        folder_path = os.path.join(FINAL_DIR, folder)
        info_file = os.path.join(folder_path, "info.json")
        if not os.path.exists(info_file):
            continue

        with open(info_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        video_file = data.get("video_file", "")
        thumb_file = data.get("thumbnail_file", "")
        video_path = os.path.join(folder_path, video_file)
        thumb_path = os.path.join(folder_path, thumb_file)

        # 1. Upload Thumbnail to Supabase Storage if bucket is ready
        cloud_thumb_url = data.get("cloud_thumbnail_url")
        if bucket_ready and not cloud_thumb_url and os.path.exists(thumb_path):
            print(f"Uploading thumbnail for {folder}...")
            cloud_thumb_url = upload_file_to_storage(
                url, key, bucket, thumb_path, f"{folder}/{thumb_file}", "image/jpeg"
            )
            if cloud_thumb_url:
                data["cloud_thumbnail_url"] = cloud_thumb_url

        # 2. Upload Video to Supabase Storage if bucket is ready
        cloud_video_url = data.get("cloud_video_url")
        if bucket_ready and not cloud_video_url and os.path.exists(video_path):
            print(f"Uploading video for {folder} ({os.path.getsize(video_path) / 1024 / 1024:.1f} MB)...")
            cloud_video_url = upload_file_to_storage(
                url, key, bucket, video_path, f"{folder}/{video_file}", "video/mp4"
            )
            if cloud_video_url:
                data["cloud_video_url"] = cloud_video_url

        # Save updated cloud URLs locally
        with open(info_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        # 3. Prepare Database Payload
        payload = {
            "id": data.get("id"),
            "title": data.get("title"),
            "titles": data.get("titles", []),
            "description": data.get("description", ""),
            "video_url": cloud_video_url or data.get("local_video_url", f"/media/{folder}/{video_file}"),
            "thumbnail_url": cloud_thumb_url or data.get("local_thumbnail_url", f"/media/{folder}/{thumb_file}"),
            "folder_name": folder,
            "series": data.get("series", ""),
            "duration": data.get("duration", ""),
            "tags": data.get("tags", []),
            "created_at": data.get("created_at")
        }

        # 4. Upsert Row into Database
        try:
            res = requests.post(rest_endpoint, headers=db_headers, json=payload, timeout=15)
            if res.status_code in (200, 201):
                synced_count += 1
                print(f"[OK] Synced {folder} to Supabase Database!")
            else:
                print(f"[Notice] DB sync for {folder}: HTTP {res.status_code} - {res.text[:120]}")
        except Exception as e:
            print(f"[Error] DB connection error for {folder}: {e}")

    print(f"\n[Result] Sync finished: {synced_count}/{len(folders)} items synced to Supabase.")
    if synced_count == 0:
        print("[Tip] If table 'public.recaps' was not found, run the SQL script in Supabase SQL Editor.")
    return True

if __name__ == "__main__":
    from vault_sync import main
    sys.exit(main())

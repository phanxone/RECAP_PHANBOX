import os
import sys
import json
import argparse
from datetime import datetime, timezone

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CLIENT_SECRETS_FILE = os.path.join(BASE_DIR, "client_secret.json")
TOKEN_FILE = os.path.join(BASE_DIR, "youtube_token.json")

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube"
]

def check_status():
    has_secret = os.path.exists(CLIENT_SECRETS_FILE)
    has_token = os.path.exists(TOKEN_FILE)
    auth_valid = False

    if has_token:
        try:
            from google.oauth2.credentials import Credentials
            creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
            auth_valid = creds and creds.valid
        except Exception:
            auth_valid = False

    return {
        "client_secret_exists": has_secret,
        "token_exists": has_token,
        "authenticated": auth_valid,
        "client_secrets_path": CLIENT_SECRETS_FILE
    }

def get_authenticated_service(interactive=False):
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds = None
    if os.path.exists(TOKEN_FILE):
        try:
            creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
        except Exception as e:
            sys.stderr.write(f"Warning: Corrupt token file: {e}\n")

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                with open(TOKEN_FILE, "w", encoding="utf-8") as token_f:
                    token_f.write(creds.to_json())
            except Exception as e:
                sys.stderr.write(f"Warning: Token refresh failed: {e}\n")
                creds = None

        if not creds:
            if not os.path.exists(CLIENT_SECRETS_FILE):
                return None, "MISSING_CLIENT_SECRET"
            
            if not interactive:
                return None, "AUTH_REQUIRED"

            try:
                flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
                creds = flow.run_local_server(port=0, open_browser=True)
                with open(TOKEN_FILE, "w", encoding="utf-8") as token_f:
                    token_f.write(creds.to_json())
            except Exception as e:
                return None, f"AUTH_FLOW_FAILED: {str(e)}"

    service = build("youtube", "v3", credentials=creds)
    return service, "OK"

def upload_and_schedule(video_path, thumbnail_path=None, title="Recap Short", description="", tags=None, schedule_iso=None, interactive=False):
    if not os.path.exists(video_path):
        return {"success": False, "error": f"Video file not found: {video_path}"}

    service, status = get_authenticated_service(interactive=interactive)
    if not service:
        if status == "MISSING_CLIENT_SECRET":
            return {
                "success": False,
                "error": "MISSING_CLIENT_SECRET",
                "message": f"ไม่พบไฟล์ client_secret.json กรุณานำไฟล์ client_secret.json มาวางไว้ที่ {CLIENT_SECRETS_FILE}"
            }
        elif status == "AUTH_REQUIRED":
            return {
                "success": False,
                "error": "AUTH_REQUIRED",
                "message": "ต้องเข้าสู่ระบบยืนยันสิทธิ์ Google Account ช่อง YouTube ก่อน"
            }
        return {"success": False, "error": status}

    from googleapiclient.http import MediaFileUpload

    tags_list = tags if isinstance(tags, list) else [t.strip() for t in str(tags).split(",") if t.strip()]

    # Snippet & Status
    body = {
        "snippet": {
            "title": title[:100],
            "description": description[:5000],
            "tags": tags_list[:30],
            "categoryId": "24" # Entertainment
        },
        "status": {
            "selfDeclaredMadeForKids": False
        }
    }

    # Scheduling requires privacyStatus='private' + publishAt=ISO8601
    if schedule_iso:
        # Validate ISO string
        try:
            # Clean and ensure trailing Z or offset
            dt = datetime.fromisoformat(schedule_iso.replace("Z", "+00:00"))
            iso_formatted = dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            body["status"]["privacyStatus"] = "private"
            body["status"]["publishAt"] = iso_formatted
        except Exception as e:
            return {"success": False, "error": f"Invalid schedule date-time format: {e}"}
    else:
        body["status"]["privacyStatus"] = "public"

    try:
        media = MediaFileUpload(video_path, chunksize=1024*1024, resumable=True)
        request = service.videos().insert(
            part="snippet,status",
            body=body,
            media_body=media
        )

        response = None
        while response is None:
            status_res, response = request.next_chunk()
            if status_res:
                progress = int(status_res.progress() * 100)
                sys.stderr.write(f"Uploading video... {progress}%\n")

        video_id = response.get("id")
        video_url = f"https://youtu.be/{video_id}"

        # Upload Custom Thumbnail if provided
        thumb_uploaded = False
        if thumbnail_path and os.path.exists(thumbnail_path) and video_id:
            try:
                thumb_media = MediaFileUpload(thumbnail_path, mimetype="image/jpeg")
                service.thumbnails().set(
                    videoId=video_id,
                    media_body=thumb_media
                ).execute()
                thumb_uploaded = True
            except Exception as e:
                sys.stderr.write(f"Thumbnail upload notice: {e}\n")

        return {
            "success": True,
            "video_id": video_id,
            "video_url": video_url,
            "title": title,
            "scheduled_time": body["status"].get("publishAt"),
            "privacy_status": body["status"]["privacyStatus"],
            "thumbnail_uploaded": thumb_uploaded,
            "message": f"ตั้งเวลาโพสต์สำเร็จ! วิดีโอจะเผยแพร่อัตโนมัติในเวลาที่กำหนด ({video_url})"
        }
    except Exception as e:
        return {"success": False, "error": f"YouTube API Error: {str(e)}"}

def main():
    parser = argparse.ArgumentParser(description="YouTube Short Auto Uploader & Scheduler")
    parser.add_argument("--check-status", action="store_true", help="Check OAuth credentials status")
    parser.add_argument("--auth-login", action="store_true", help="Run local OAuth flow in browser")
    parser.add_argument("--video", type=str, help="Path to video file")
    parser.add_argument("--thumbnail", type=str, help="Path to thumbnail image")
    parser.add_argument("--title", type=str, default="", help="Video title")
    parser.add_argument("--description", type=str, default="", help="Video description")
    parser.add_argument("--tags", type=str, default="", help="Comma-separated tags")
    parser.add_argument("--schedule", type=str, default=None, help="Scheduled publish time (ISO format)")
    parser.add_argument("--interactive", action="store_true", help="Allow interactive OAuth browser popup")

    args = parser.parse_args()

    if args.check_status:
        print(json.dumps(check_status(), ensure_ascii=False))
        return

    if args.auth_login:
        service, status = get_authenticated_service(interactive=True)
        if service:
            print(json.dumps({"success": True, "message": "ยืนยันสิทธิ์กับ YouTube สำเร็จแล้ว!"}, ensure_ascii=False))
        else:
            print(json.dumps({"success": False, "error": status}, ensure_ascii=False))
        return

    if args.video:
        res = upload_and_schedule(
            video_path=args.video,
            thumbnail_path=args.thumbnail,
            title=args.title,
            description=args.description,
            tags=args.tags,
            schedule_iso=args.schedule,
            interactive=args.interactive
        )
        print(json.dumps(res, ensure_ascii=False))
        return

    parser.print_help()

if __name__ == "__main__":
    main()

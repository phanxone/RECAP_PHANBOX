import sys
import os
import json
import time
import urllib.request
import subprocess
import asyncio
import imageio_ffmpeg
import edge_tts
from gtts import gTTS

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')
ASSETS_DIR = os.path.join(os.path.dirname(__file__), 'assets')
os.makedirs(OUTPUT_DIR, exist_ok=True)

def generate_voice(text, output_path, voice_choice='niwat'):
    if voice_choice == 'niwat':
        try:
            async def _synthesize():
                comm = edge_tts.Communicate(text, 'th-TH-NiwatNeural')
                await comm.save(output_path)
            asyncio.run(_synthesize())
            if os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
                return 'niwat'
        except Exception as e:
            sys.stderr.write(f"Niwat TTS warning: {e}, falling back to gTTS\n")

    # Fallback or explicit gTTS
    tts = gTTS(text=text, lang='th', slow=False)
    tts.save(output_path)
    return 'gtts'

def get_audio_duration(ffmpeg_exe, audio_file):
    try:
        cmd = [ffmpeg_exe, '-i', audio_file]
        res = subprocess.run(cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True)
        # Parse Duration: 00:00:15.34
        for line in res.stderr.splitlines():
            if 'Duration:' in line:
                dur_str = line.split('Duration:')[1].split(',')[0].strip()
                parts = dur_str.split(':')
                h = float(parts[0])
                m = float(parts[1])
                s = float(parts[2])
                return round(h * 3600 + m * 60 + s, 1)
    except Exception as e:
        pass
    return 15.0

def download_or_resolve_image(thumbnail_url):
    local_temp = os.path.join(OUTPUT_DIR, 'current_thumb.jpg')
    default_img = os.path.join(ASSETS_DIR, 'anime_recap_thumbnail.jpg')
    
    if not thumbnail_url or not thumbnail_url.startswith('http'):
        if os.path.exists(default_img):
            return default_img
        return None

    try:
        req = urllib.request.Request(
            thumbnail_url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=8) as resp, open(local_temp, 'wb') as out_f:
            out_f.write(resp.read())
        if os.path.exists(local_temp) and os.path.getsize(local_temp) > 1000:
            return local_temp
    except Exception as e:
        sys.stderr.write(f"Thumbnail download warning: {e}\n")

    if os.path.exists(default_img):
        return default_img
    return local_temp

def main():
    if hasattr(sys.stdin, 'reconfigure'):
        sys.stdin.reconfigure(encoding='utf-8')
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')

    try:
        raw_bytes = sys.stdin.buffer.read()
        raw_input = raw_bytes.decode('utf-8', errors='replace')
    except Exception:
        raw_input = sys.stdin.read()

    if not raw_input.strip():
        print(json.dumps({"success": False, "error": "No input provided"}))
        return

    try:
        data = json.loads(raw_input)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Invalid JSON: {str(e)}"}))
        return

    text = data.get('text', '').strip()
    thumbnail_url = data.get('thumbnailUrl', '')
    aspect_ratio = data.get('aspectRatio', '9:16')  # '9:16' or '16:9'
    speed = float(data.get('speed', 1.0))
    voice = data.get('voice', 'niwat')

    if not text:
        print(json.dumps({"success": False, "error": "Text script is empty"}))
        return

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    ts = int(time.time() * 1000)

    # 1. Generate Thai Voiceover using Niwat (BellyG style) or gTTS
    audio_filename = f"recap_voice_{ts}.mp3"
    audio_path = os.path.join(OUTPUT_DIR, audio_filename)
    
    try:
        used_voice = generate_voice(text, audio_path, voice_choice=voice)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"TTS synthesis failed: {str(e)}"}))
        return

    # Adjust speed if speed != 1.0 using FFmpeg atempo filter
    if abs(speed - 1.0) > 0.05 and 0.5 <= speed <= 2.0:
        adjusted_audio = os.path.join(OUTPUT_DIR, f"speed_{audio_filename}")
        speed_cmd = [
            ffmpeg_exe, '-y', '-i', audio_path,
            '-filter:a', f"atempo={speed}",
            '-vn', adjusted_audio
        ]
        s_proc = subprocess.run(speed_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if s_proc.returncode == 0 and os.path.exists(adjusted_audio):
            audio_path = adjusted_audio
            audio_filename = f"speed_{audio_filename}"

    duration_sec = get_audio_duration(ffmpeg_exe, audio_path)

    # 2. Resolve image/thumbnail
    image_path = download_or_resolve_image(thumbnail_url)

    # 3. Render MP4 Recap Video with FFmpeg
    video_filename = f"recap_video_{ts}.mp4"
    video_path = os.path.join(OUTPUT_DIR, video_filename)

    if aspect_ratio == '9:16':
        # TikTok / Shorts Vertical (1080x1920) with blurred background & centered clean thumbnail
        filter_complex = (
            "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,boxblur=25:5[bg];"
            "[0:v]scale=1020:574:force_original_aspect_ratio=decrease[fg];"
            "[bg][fg]overlay=(W-w)/2:(H-h)/2[v]"
        )
    else:
        # Standard 16:9 Landscape (1280x720)
        filter_complex = (
            "[0:v]scale=1280:720:force_original_aspect_ratio=increase,"
            "crop=1280:720,boxblur=15:3[bg];"
            "[0:v]scale=1280:720:force_original_aspect_ratio=decrease[fg];"
            "[bg][fg]overlay=(W-w)/2:(H-h)/2[v]"
        )

    ffmpeg_cmd = [
        ffmpeg_exe, '-y',
        '-loop', '1', '-i', image_path,
        '-i', audio_path,
        '-filter_complex', filter_complex,
        '-map', '[v]', '-map', '1:a',
        '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage',
        '-c:a', 'aac', '-b:a', '192k',
        '-pix_fmt', 'yuv420p',
        '-shortest',
        video_path
    ]

    v_proc = subprocess.run(ffmpeg_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if v_proc.returncode != 0 or not os.path.exists(video_path):
        print(json.dumps({
            "success": False,
            "error": f"FFmpeg video render failed: {v_proc.stderr[:200]}"
        }))
        return

    result = {
        "success": True,
        "audioUrl": f"/output/{audio_filename}",
        "videoUrl": f"/output/{video_filename}",
        "audioFilename": audio_filename,
        "videoFilename": video_filename,
        "durationSec": duration_sec,
        "aspectRatio": aspect_ratio,
        "voice": used_voice,
        "generatedAt": ts
    }
    print(json.dumps(result))

if __name__ == '__main__':
    main()

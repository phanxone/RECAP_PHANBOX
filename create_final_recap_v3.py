import os
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')
import json
import asyncio
import subprocess
import imageio_ffmpeg
import edge_tts

OUTPUT_DIR = r"C:\71006\phanbox\final"
TEMP_DIR = os.path.join(os.path.dirname(__file__), "temp_v3_work")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()

def format_ass_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"

# 100% Curated, frame-verified story beats matching narration precisely
SEGMENTS = [
    {
        "id": 1,
        "text": "จะเป็นอย่างไร เมื่อเบ็นเท็นทะลุมิติมาเจอกับ เบ็น 23 ตัวเขาเองจากอีกมิติ ที่นิสัยต่างกันสุดขั้ว!",
        "video_start": 52.0,  # Ben 23 waving, XLR8 zooms in and stops face-to-face
        "crop_x": 230,
        "subtitles": [
            {"text": "จะเป็นอย่างไร เมื่อเบ็นเท็นทะลุมิติมาเจอกับ เบ็น 23", "ratio": 0.52},
            {"text": "ตัวเขาเองจากอีกมิติ ที่นิสัยต่างกันสุดขั้ว!", "ratio": 0.48}
        ]
    },
    {
        "id": 2,
        "text": "ในมิตินี้ เบ็น 23 เป็นเด็กมหาเศรษฐีชื่อดัง มี Omnitrix สีทองสุดหรู และใช้พลังเพื่อความเด่นดัง!",
        "video_start": 81.5,  # Ben 23 flaunting with camera drones hovering around broadcasting him
        "crop_x": 215,
        "subtitles": [
            {"text": "ในมิตินี้ เบ็น 23 เป็นเด็กมหาเศรษฐีชื่อดัง", "ratio": 0.45},
            {"text": "มี Omnitrix สีทองสุดหรู และใช้พลังเพื่อความเด่นดัง!", "ratio": 0.55}
        ]
    },
    {
        "id": 3,
        "text": "แถมเขายังเข้าใจผิด คิดว่าเอเลี่ยนทุกตัวเป็นสัตว์ประหลาดดุร้ายที่ต้องคอยกำจัดทิ้ง!",
        "video_start": 100.5, # Giant menacing robotic alien villains marching forward
        "crop_x": 220,
        "subtitles": [
            {"text": "แถมเขายังเข้าใจผิด คิดว่าเอเลี่ยนทุกตัว", "ratio": 0.48},
            {"text": "เป็นสัตว์ประหลาดดุร้าย ที่ต้องคอยกำจัดทิ้ง!", "ratio": 0.52}
        ]
    },
    {
        "id": 4,
        "text": "จนกระทั่งเกิดเหตุร้าย ทั้งคู่จึงตบ Omnitrix แปลงร่างร่วมมือกันเปิดฉากต่อสู้!",
        "video_start": 109.5, # Shocksquatch & Heatblast ready for battle side-by-side
        "crop_x": 230,
        "subtitles": [
            {"text": "จนกระทั่งเกิดเหตุร้าย ทั้งคู่จึงตบ Omnitrix", "ratio": 0.48},
            {"text": "แปลงร่างร่วมมือกันเปิดฉากต่อสู้แบบแท็กทีม!", "ratio": 0.52}
        ]
    },
    {
        "id": 5,
        "text": "แต่ด้วยความอ่อนประสบการณ์ ทำให้เบ็น 23 พลาดท่า โดนเอเลี่ยนศัตรูเล่นงานจนเสียหลัก!",
        "video_start": 138.0, # Shocksquatch screaming with electric bolts, wrestling alien on back
        "crop_x": 220,
        "subtitles": [
            {"text": "แต่ด้วยความอ่อนประสบการณ์ ทำให้เบ็น 23 พลาดท่า", "ratio": 0.52},
            {"text": "โดนเอเลี่ยนศัตรูเล่นงานจนเสียหลัก!", "ratio": 0.48}
        ]
    },
    {
        "id": 6,
        "text": "เบ็นหลักของเราจึงต้องเข้าช่วย พร้อมชี้แนะว่า การเป็นฮีโร่ที่แท้จริง คือการปกป้องผู้คน ไม่ใช่การโอ้อวด!",
        "video_start": 174.5, # Heatblast pinning alien, then standing to fire flames
        "crop_x": 170,
        "subtitles": [
            {"text": "เบ็นหลักของเราจึงต้องเข้าช่วย พร้อมชี้แนะว่า", "ratio": 0.46},
            {"text": "การเป็นฮีโร่ที่แท้จริง คือการปกป้องผู้คน ไม่ใช่การโอ้อวด!", "ratio": 0.54}
        ]
    },
    {
        "id": 7,
        "text": "การร่วมมือข้ามมิติครั้งนี้ จึงกลายเป็นบทเรียนครั้งสำคัญ ที่ทำให้เบ็น 23 เริ่มเข้าใจความหมายของฮีโร่!",
        "video_start": 56.5,  # XLR8 mentoring Ben 23, Ben 23 listening thoughtfully
        "crop_x": 225,
        "subtitles": [
            {"text": "การร่วมมือข้ามมิติครั้งนี้ จึงกลายเป็นบทเรียนสำคัญ", "ratio": 0.50},
            {"text": "ที่ทำให้เบ็น 23 เริ่มเข้าใจความหมายของฮีโร่!", "ratio": 0.50}
        ]
    }
]

def get_media_duration(file_path):
    cmd = [FFMPEG_EXE, '-i', file_path]
    res = subprocess.run(cmd, stderr=subprocess.PIPE, text=True)
    for line in res.stderr.splitlines():
        if 'Duration:' in line:
            dur_str = line.split('Duration:')[1].split(',')[0].strip()
            parts = dur_str.split(':')
            return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
    return 5.0

async def generate_segment_audio(seg, idx):
    out_mp3 = os.path.join(TEMP_DIR, f"seg_{idx}.mp3")
    comm = edge_tts.Communicate(seg["text"], "th-TH-NiwatNeural")
    await comm.save(out_mp3)
    dur = get_media_duration(out_mp3)
    return out_mp3, dur

def cut_and_crop_916_video(raw_video, start_time, target_dur, crop_x, idx):
    out_video = os.path.join(TEMP_DIR, f"clip_{idx}.mp4")
    crop_w = 202
    crop_h = 360
    
    # 9:16 crop directly from 640x360 source
    vf = f"crop={crop_w}:{crop_h}:{crop_x}:0,scale=1080:1920:flags=lanczos,setsar=1"

    cmd = [
        FFMPEG_EXE, '-y',
        '-ss', str(start_time),
        '-t', str(target_dur),
        '-i', raw_video,
        '-vf', vf,
        '-r', '25',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        '-c:a', 'aac', '-b:a', '128k',
        out_video
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out_video

async def build_v3_recap():
    raw_video = os.path.join(os.path.dirname(__file__), "temp_download", "ben10_raw.mp4")
    if not os.path.exists(raw_video):
        print(f"Error: raw video {raw_video} not found!")
        return

    print("Step 1: Generating Niwat voiceover & precisely cropped 9:16 footage...")
    audio_files = []
    video_files = []
    durations = []

    for i, seg in enumerate(SEGMENTS):
        print(f"  -> Segment {i+1}: Generating TTS audio...")
        audio_file, dur = await generate_segment_audio(seg, i+1)
        durations.append(dur)
        audio_files.append(audio_file)
        
        print(f"  -> Segment {i+1}: Cutting video (start={seg['video_start']}s, dur={dur:.2f}s, crop_x={seg['crop_x']})...")
        v_clip = cut_and_crop_916_video(raw_video, seg['video_start'], dur, seg['crop_x'], i+1)
        video_files.append(v_clip)

    total_duration = sum(durations)
    print(f"Total video duration: {total_duration:.2f}s")

    # Step 2: Concat video segments
    print("Step 2: Concatenating video clips...")
    concat_list_file = os.path.join(TEMP_DIR, "video_list.txt")
    with open(concat_list_file, "w", encoding="utf-8") as f:
        for v in video_files:
            clean_path = v.replace("\\", "/")
            f.write(f"file '{clean_path}'\n")

    concatenated_video = os.path.join(TEMP_DIR, "concat_visual.mp4")
    cmd_concat_v = [
        FFMPEG_EXE, '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concat_list_file,
        '-c', 'copy',
        concatenated_video
    ]
    subprocess.run(cmd_concat_v, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Step 3: Concat voiceover audio
    print("Step 3: Concatenating voiceover audio...")
    concat_audio_file = os.path.join(TEMP_DIR, "audio_list.txt")
    with open(concat_audio_file, "w", encoding="utf-8") as f:
        for a in audio_files:
            clean_path = a.replace("\\", "/")
            f.write(f"file '{clean_path}'\n")

    full_voice_audio = os.path.join(TEMP_DIR, "full_voice.mp3")
    cmd_concat_a = [
        FFMPEG_EXE, '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concat_audio_file,
        '-c', 'copy',
        full_voice_audio
    ]
    subprocess.run(cmd_concat_a, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Step 4: Generate ASS Subtitles
    print("Step 4: Generating stylish synchronized Thai subtitles...")
    ass_path = os.path.join(TEMP_DIR, "subtitles.ass")
    ass_content = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Header,Arial,52,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,-1,0,0,0,100,100,1,0,1,5,3,8,40,40,110,1
Style: Subtitle,Arial,66,&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,6,4,2,50,50,250,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,{format_ass_time(total_duration)},Header,,0,0,0,,{{\\c&H0022FFFF&\\b1}}⭐ BEN 10 OMNIVERSE ⭐\\N{{\\c&H00FFFFFF&\\fs44}}เบ็น ปะทะ เบ็น 23 ต่างมิติ!
"""

    current_t = 0.0
    for i, seg in enumerate(SEGMENTS):
        dur = durations[i]
        subs = seg["subtitles"]
        sub_t = current_t
        for s in subs:
            s_dur = dur * s["ratio"]
            start_str = format_ass_time(sub_t)
            end_str = format_ass_time(sub_t + s_dur)
            ass_content += f"Dialogue: 0,{start_str},{end_str},Subtitle,,0,0,0,,{s['text']}\n"
            sub_t += s_dur
        current_t += dur

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(ass_content)

    # Step 5: Final Render with audio mixing & burned-in ASS subtitles
    final_output = os.path.join(OUTPUT_DIR, "ben10_omniverse_recap_short.mp4")
    print(f"Step 5: Final assembly and rendering to {final_output}...")
    
    clean_ass = ass_path.replace("\\", "/").replace(":", "\\:")
    vf_final = f"subtitles='{clean_ass}'"
    filter_complex = "[1:a]volume=1.0[vce];[0:a]volume=0.10[sfx];[vce][sfx]amix=inputs=2:duration=first:dropout_transition=2[aout]"

    cmd_final = [
        FFMPEG_EXE, '-y',
        '-i', concatenated_video,
        '-i', full_voice_audio,
        '-filter_complex', filter_complex,
        '-map', '0:v',
        '-map', '[aout]',
        '-vf', vf_final,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        '-c:a', 'aac', '-b:a', '192k',
        '-t', str(total_duration),
        final_output
    ]

    res = subprocess.run(cmd_final, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        print("Error during final rendering:")
        print(res.stderr[-1000:])
    else:
        print(f"SUCCESS! Output generated at: {final_output}")
        if os.path.exists(final_output):
            print(f"File size: {os.path.getsize(final_output):,} bytes")

if __name__ == "__main__":
    asyncio.run(build_v3_recap())

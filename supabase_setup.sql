-- ====================================================================
-- RECAP VAULT: SUPABASE SETUP SCRIPT (รันใน Supabase > SQL Editor)
-- สร้างทั้งตาราง Database และ Storage Bucket พร้อมเปิดสิทธิ์เข้าถึงทั้งหมด
-- ====================================================================

-- 1. สร้างตารางเก็บข้อมูลคลิปสรุป (public.recaps)
CREATE TABLE IF NOT EXISTS public.recaps (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    titles JSONB DEFAULT '[]'::jsonb,
    description TEXT,
    video_url TEXT,
    thumbnail_url TEXT,
    folder_name TEXT,
    series TEXT,
    duration TEXT,
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- เปิด Row Level Security (RLS)
ALTER TABLE public.recaps ENABLE ROW LEVEL SECURITY;

-- ลบนโยบายเก่าถ้ามี เพื่อป้องกัน error
DROP POLICY IF EXISTS "Allow public read" ON public.recaps;
DROP POLICY IF EXISTS "Allow public insert" ON public.recaps;
DROP POLICY IF EXISTS "Allow public update" ON public.recaps;
DROP POLICY IF EXISTS "Allow public delete" ON public.recaps;

-- สร้างนโยบายอนุญาตให้อ่าน เขียน และลบข้อมูลได้
CREATE POLICY "Allow public read" ON public.recaps FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON public.recaps FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON public.recaps FOR UPDATE USING (true);
CREATE POLICY "Allow public delete" ON public.recaps FOR DELETE USING (true);

-- --------------------------------------------------------------------
-- 2. สร้าง Storage Bucket สำหรับเก็บไฟล์วิดีโอ .mp4 และรูปปก .jpg
-- --------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('recaps', 'recaps', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- ลบนโยบายเก่าของ storage ถ้ามี
DROP POLICY IF EXISTS "Public Read Recaps" ON storage.objects;
DROP POLICY IF EXISTS "Public Insert Recaps" ON storage.objects;
DROP POLICY IF EXISTS "Public Update Recaps" ON storage.objects;

-- อนุญาตให้อ่านไฟล์ (ดาวน์โหลด/เล่นวิดีโอ) จาก Bucket recaps
CREATE POLICY "Public Read Recaps" ON storage.objects 
FOR SELECT USING (bucket_id = 'recaps');

-- อนุญาตให้อัปโหลดไฟล์ลง Bucket recaps
CREATE POLICY "Public Insert Recaps" ON storage.objects 
FOR INSERT WITH CHECK (bucket_id = 'recaps');

-- อนุญาตให้อัปเดตไฟล์ใน Bucket recaps
CREATE POLICY "Public Update Recaps" ON storage.objects 
FOR UPDATE USING (bucket_id = 'recaps');

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BASE_DIR = __dirname;
const FINAL_DIR = path.join(BASE_DIR, 'final');
const ENV_FILE = path.join(BASE_DIR, '.env');

function loadEnv() {
  if (fs.existsSync(ENV_FILE)) {
    const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
}
loadEnv();

const PORT = process.env.PORT || 5000;

if (!fs.existsSync(FINAL_DIR)) {
  fs.mkdirSync(FINAL_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

function getLocalRecaps() {
  const recaps = [];
  if (!fs.existsSync(FINAL_DIR)) return recaps;

  const folders = fs.readdirSync(FINAL_DIR).filter(f => {
    return fs.statSync(path.join(FINAL_DIR, f)).isDirectory();
  });

  // Sort folders in descending chronological order
  folders.sort().reverse();

  for (const folder of folders) {
    const infoPath = path.join(FINAL_DIR, folder, 'info.json');
    if (fs.existsSync(infoPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
        data.local_video_url = `/media/${folder}/${data.video_file}`;
        data.local_thumbnail_url = `/media/${folder}/${data.thumbnail_file}`;
        recaps.push(data);
      } catch (e) {
        console.error('Error parsing info.json in', folder, e);
      }
    }
  }
  return recaps;
}

function getSupabaseConfig() {
  loadEnv();
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_KEY || '';
  const bucket = process.env.SUPABASE_BUCKET || 'recaps';
  return {
    configured: Boolean(url && key),
    supabase_url: url,
    supabase_bucket: bucket,
    has_key: Boolean(key)
  };
}

function handleMedia(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Media not found');
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  if (range && ext === '.mp4') {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // 1. Media streaming: /media/:folder/:filename
  if (pathname.startsWith('/media/')) {
    const parts = pathname.replace('/media/', '').split('/');
    if (parts.length >= 2) {
      const folder = parts[0];
      const filename = parts.slice(1).join('/');
      const mediaPath = path.join(FINAL_DIR, folder, filename);
      return handleMedia(req, res, mediaPath);
    }
  }

  // 2. API: /api/recaps (GET)
  if (pathname === '/api/recaps' && req.method === 'GET') {
    const recaps = getLocalRecaps();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ success: true, count: recaps.length, data: recaps }));
  }

  // 2.1 API: DELETE /api/recaps/:id
  if (pathname.startsWith('/api/recaps/') && req.method === 'DELETE') {
    const id = pathname.replace('/api/recaps/', '').trim();
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing clip ID' }));
    }

    // 1. Delete local folder in final/
    let deletedLocal = false;
    let targetFolder = '';
    const recaps = getLocalRecaps();
    const item = recaps.find(r => r.id === id);
    if (item && item.folder) {
      targetFolder = item.folder;
      const folderPath = path.join(FINAL_DIR, item.folder);
      if (fs.existsSync(folderPath)) {
        try {
          fs.rmSync(folderPath, { recursive: true, force: true });
          deletedLocal = true;
          console.log(`Deleted local folder: ${folderPath}`);
        } catch (e) {
          console.error('Error deleting local folder:', e);
        }
      }
    }

    // 2. Delete from Supabase Database & Storage if configured
    loadEnv();
    const sUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const sKey = (process.env.SUPABASE_KEY || '').trim();

    if (sUrl && sKey) {
      const dbUrl = `${sUrl}/rest/v1/recaps?id=eq.${encodeURIComponent(id)}`;
      const https = sUrl.startsWith('https') ? require('https') : require('http');
      
      const sReq = https.request(dbUrl, {
        method: 'DELETE',
        headers: {
          'apikey': sKey,
          'Authorization': `Bearer ${sKey}`
        }
      }, (sRes) => {
        let respData = '';
        sRes.on('data', c => respData += c);
        sRes.on('end', () => {
          console.log(`Supabase DB delete for ${id}: HTTP ${sRes.statusCode}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            success: true,
            id: id,
            deleted_local: deletedLocal,
            supabase_status: sRes.statusCode,
            message: 'ลบคลิปสำเร็จทั้งจากเครื่องและ Supabase'
          }));
        });
      });

      sReq.on('error', (err) => {
        console.error('Supabase delete request error:', err);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          success: true,
          id: id,
          deleted_local: deletedLocal,
          message: 'ลบคลิปในเครื่องสำเร็จ (Supabase: ' + err.message + ')'
        }));
      });

      sReq.end();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      success: true,
      id: id,
      deleted_local: deletedLocal,
      message: 'ลบคลิปในเครื่องสำเร็จ'
    }));
  }

  // 3. API: /api/config
  if (pathname === '/api/config') {
    if (req.method === 'GET') {
      const config = getSupabaseConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(config));
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const newConfig = JSON.parse(body);
          if (newConfig.supabase_url !== undefined && newConfig.supabase_key !== undefined) {
            let envContent = `# ===================================================\n`;
            envContent += `# RECAP VAULT - SUPABASE & SERVER CONFIGURATION\n`;
            envContent += `# ===================================================\n\n`;
            envContent += `SUPABASE_URL=${newConfig.supabase_url || ''}\n`;
            envContent += `SUPABASE_KEY=${newConfig.supabase_key || ''}\n`;
            envContent += `SUPABASE_BUCKET=${newConfig.supabase_bucket || 'recaps'}\n`;
            envContent += `PORT=${process.env.PORT || 5000}\n`;
            fs.writeFileSync(ENV_FILE, envContent, 'utf8');
            loadEnv();
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, message: '.env updated' }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // 4. API: /api/sync (also available as a manual retry)
  if (pathname === '/api/sync' && req.method === 'POST') {
    const py = spawn('python', [path.join(BASE_DIR, 'sync_supabase.py')], {
      cwd: BASE_DIR,
      windowsHide: true
    });
    let output = '';
    let errorOutput = '';
    py.stdout.on('data', d => output += d.toString());
    py.stderr.on('data', d => errorOutput += d.toString());
    py.on('close', code => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: code === 0,
        exit_code: code,
        output: output || errorOutput
      }));
    });
    return;
  }

  // 4.1 YouTube API: /api/youtube/status (GET)
  if (pathname === '/api/youtube/status' && req.method === 'GET') {
    const py = spawn('python', [path.join(BASE_DIR, 'youtube_uploader.py'), '--check-status'], { cwd: BASE_DIR });
    let stdout = '';
    py.stdout.on('data', d => stdout += d.toString());
    py.on('close', () => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      try {
        res.end(stdout.trim() || '{}');
      } catch (e) {
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 4.2 YouTube API: /api/youtube/upload-secret (POST)
  if (pathname === '/api/youtube/upload-secret' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const jsonContent = JSON.parse(body);
        const secretPath = path.join(BASE_DIR, 'client_secret.json');
        fs.writeFileSync(secretPath, JSON.stringify(jsonContent, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, message: 'บันทึกไฟล์ client_secret.json สำเร็จแล้ว!' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'รูปแบบไฟล์ JSON ไม่ถูกต้อง: ' + e.message }));
      }
    });
    return;
  }

  // 4.3 YouTube API: /api/youtube/auth (POST) - Trigger local OAuth browser flow
  if (pathname === '/api/youtube/auth' && req.method === 'POST') {
    const py = spawn('python', [path.join(BASE_DIR, 'youtube_uploader.py'), '--auth-login'], { cwd: BASE_DIR });
    let stdout = '';
    py.stdout.on('data', d => stdout += d.toString());
    py.on('close', code => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      try {
        res.end(stdout.trim() || JSON.stringify({ success: code === 0 }));
      } catch (e) {
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // 4.4 YouTube API: /api/youtube/schedule (POST)
  if (pathname === '/api/youtube/schedule' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const clipId = payload.clip_id;
        const recaps = getLocalRecaps();
        const item = recaps.find(r => r.id === clipId || r.folder === clipId);

        if (!item) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ success: false, error: 'ไม่พบคลิปนี้ในระบบ' }));
        }

        const videoPath = path.join(FINAL_DIR, item.folder, item.video_file);
        const thumbPath = path.join(FINAL_DIR, item.folder, item.thumbnail_file);

        if (!fs.existsSync(videoPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ success: false, error: 'ไม่พบไฟล์วิดีโอบนเครื่อง' }));
        }

        const title = payload.title || item.title || 'Recap Short';
        const description = payload.description || item.description || '';
        const tags = Array.isArray(item.tags) ? item.tags.join(',') : (item.tags || '');
        const scheduleTime = payload.schedule_time; // ISO String

        const args = [
          path.join(BASE_DIR, 'youtube_uploader.py'),
          '--video', videoPath,
          '--thumbnail', thumbPath,
          '--title', title,
          '--description', description,
          '--tags', tags
        ];

        if (scheduleTime) {
          args.push('--schedule', scheduleTime);
        }

        const py = spawn('python', args, { cwd: BASE_DIR });
        let stdout = '';
        let stderr = '';
        py.stdout.on('data', d => stdout += d.toString());
        py.stderr.on('data', d => stderr += d.toString());
        py.on('close', code => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          try {
            const parsed = JSON.parse(stdout.trim());
            res.end(JSON.stringify(parsed));
          } catch (e) {
            res.end(JSON.stringify({
              success: false,
              exit_code: code,
              error: stdout.trim() || stderr.trim() || 'เกิดข้อผิดพลาดในการอัปโหลด'
            }));
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // 5. Static files (index.html, style.css, app.js)
  let staticPath = path.join(BASE_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(staticPath) || fs.statSync(staticPath).isDirectory()) {
    staticPath = path.join(BASE_DIR, 'index.html');
  }

  const ext = path.extname(staticPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(staticPath, (err, content) => {
    if (err) {
      res.writeHead(500);
      return res.end('Server Error');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

// Keep finalized folders in Supabase without requiring a button click. The
// sync script hashes media and only uploads files whose path/content changed.
const pendingSync = new Set();
let syncTimer = null;
let syncRunning = false;

function flushAutoSync() {
  syncTimer = null;
  if (syncRunning || pendingSync.size === 0) return;
  const folder = pendingSync.values().next().value;
  pendingSync.delete(folder);
  syncRunning = true;
  const py = spawn('python', [path.join(BASE_DIR, 'vault_sync.py'), '--folder', folder], {
    cwd: BASE_DIR,
    windowsHide: true
  });
  let message = '';
  py.stdout.on('data', d => message += d.toString());
  py.stderr.on('data', d => message += d.toString());
  py.on('error', err => {
    console.error(`Auto sync could not start for ${folder}:`, err);
  });
  py.on('close', code => {
    if (code !== 0) console.error(`Auto sync failed for ${folder}: ${message.trim()}`);
    else console.log(`Auto sync complete for ${folder}`);
    syncRunning = false;
    if (pendingSync.size) syncTimer = setTimeout(flushAutoSync, 800);
  });
}

function scheduleAutoSync(folder) {
  if (!folder || !/^[a-zA-Z0-9_-]+$/.test(folder)) return;
  const location = path.resolve(FINAL_DIR, folder);
  if (path.dirname(location) !== FINAL_DIR ||
      !fs.existsSync(path.join(location, 'info.json'))) return;
  pendingSync.add(folder);
  if (!syncRunning && !syncTimer) syncTimer = setTimeout(flushAutoSync, 800);
}

try {
  fs.watch(FINAL_DIR, { recursive: true }, (_event, filename) => {
    if (filename) scheduleAutoSync(String(filename).split(/[\\/]/)[0]);
  });
} catch (err) {
  console.error('Could not watch final/ for automatic sync:', err);
}

server.listen(PORT, () => {
  console.log(`Vault Web App running at http://localhost:${PORT}`);
  for (const entry of fs.readdirSync(FINAL_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) scheduleAutoSync(entry.name);
  }
});

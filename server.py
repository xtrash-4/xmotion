import asyncio
import html
import mimetypes
import os
import sys
import shutil
import uuid
import threading
from fastapi import FastAPI, File, UploadFile, Form, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.background import BackgroundTask
import subprocess
import urllib.request
import urllib.parse
import json
import re
import uvicorn

import render_jj
import render_jj2
import render_jj3

app = FastAPI(title="Retro Y2K Jedag-Jedug Studio")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    path = request.url.path.lower()
    if path.endswith((".js", ".html", ".json", ".css")) or path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "outputs")
AUDIO_FILE = os.path.join(BASE_DIR, "audio.m4a")

os.makedirs(WEB_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Copy default photos to uploads if available
for f in ["foto1.jpg", "foto2.jpg", "foto3.jpg"]:
    src = os.path.join(BASE_DIR, f)
    dst = os.path.join(UPLOADS_DIR, f)
    if os.path.exists(src) and not os.path.exists(dst):
        shutil.copy(src, dst)

# Render state tracker
render_state = {
    "status": "idle", # idle, rendering, done, error
    "progress": 0,
    "error": None,
    "video_name": "hasil_jedag_jedug.mp4"
}
render_lock = threading.Lock()

_SAFE_NAME = re.compile(r'^[^/\\:*?"<>|\x00]+$')

TEMP_UPLOAD_PREFIXES = ("audio_extracted_", "tiktok_", "temp_vid_")

def _remove_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass

def safe_name(value: str) -> bool:
    """Tolak nama file/id yang bisa keluar dari folder (.., slash, backslash)."""
    return bool(value) and value not in (".", "..") and bool(_SAFE_NAME.match(value))

@app.get("/audio")
@app.get("/audio.m4a")
async def get_audio():
    p = os.path.join(BASE_DIR, "audio.m4a")
    if not os.path.exists(p):
        p = os.path.join(WEB_DIR, "audio.m4a")
    if os.path.exists(p):
        return FileResponse(p, media_type="audio/mp4")
    return JSONResponse({"error": "Audio file not found"}, status_code=404)

@app.get("/audio2.m4a")
async def get_audio2():
    p = os.path.join(BASE_DIR, "audio2.m4a")
    if not os.path.exists(p):
        p = os.path.join(WEB_DIR, "audio2.m4a")
    if os.path.exists(p):
        return FileResponse(p, media_type="audio/mp4")
    return JSONResponse({"error": "Audio2 file not found"}, status_code=404)

@app.get("/audio3.m4a")
async def get_audio3():
    p = os.path.join(BASE_DIR, "audio3.m4a")
    if not os.path.exists(p):
        p = os.path.join(WEB_DIR, "audio3.m4a")
    if os.path.exists(p):
        return FileResponse(p, media_type="audio/mp4")
    return JSONResponse({"error": "Audio3 file not found"}, status_code=404)

@app.get("/api/defaults")
async def get_defaults():
    # Return available default photos
    p1 = "/api/photos/foto1.jpg" if os.path.exists(os.path.join(UPLOADS_DIR, "foto1.jpg")) else None
    p2 = "/api/photos/foto2.jpg" if os.path.exists(os.path.join(UPLOADS_DIR, "foto2.jpg")) else None
    p3 = "/api/photos/foto3.jpg" if os.path.exists(os.path.join(UPLOADS_DIR, "foto3.jpg")) else p1
    return {
        "foto1": p1,
        "foto2": p2,
        "foto3": p3
    }

@app.get("/api/photos/{filename}")
async def get_photo(filename: str):
    if not safe_name(filename):
        return JSONResponse({"error": "Invalid filename"}, status_code=400)
    file_path = os.path.join(UPLOADS_DIR, filename)
    if os.path.exists(file_path):
        # File hasil ekstrak audio / TikTok hanya perantara: dihapus setelah dikirim ke browser
        # supaya folder uploads tidak menumpuk.
        if filename.startswith(TEMP_UPLOAD_PREFIXES):
            return FileResponse(file_path, background=BackgroundTask(_remove_quietly, file_path))
        return FileResponse(file_path)
    return JSONResponse({"error": "Photo not found"}, status_code=404)

@app.post("/api/upload")
async def upload_photo(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
        ext = ".jpg"
    unique_name = f"photo_{uuid.uuid4().hex[:8]}{ext}"
    dest_path = os.path.join(UPLOADS_DIR, unique_name)
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {
        "filename": unique_name,
        "url": f"/api/photos/{unique_name}"
    }

# =====================================================================
# ALIGHT MOTION RUNTIME & PRESET EXTENSION ENDPOINTS
# =====================================================================
@app.get("/api/effect-bin")
async def get_effect_bin(id: str):
    if not safe_name(id):
        return JSONResponse({"error": "Invalid effect id"}, status_code=400)
    local_path = os.path.join(WEB_DIR, "runtime", "effects", f"{id}.bin")
    if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
        return FileResponse(local_path, media_type="application/octet-stream")
    try:
        remote_url = f"https://am.zervida.my.id/api/effect-bin?id={id}"
        req = urllib.request.Request(remote_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
            with open(local_path, "wb") as fp:
                fp.write(data)
            return FileResponse(local_path, media_type="application/octet-stream")
    except Exception as e:
        return JSONResponse({"error": f"Effect {id} not found: {e}"}, status_code=404)

@app.get("/api/presets")
async def get_presets():
    presets_dir = os.path.join(WEB_DIR, "runtime", "presets")
    os.makedirs(presets_dir, exist_ok=True)
    xml_files = [f for f in os.listdir(presets_dir) if f.endswith(".xml")]
    audio_files = [f for f in os.listdir(presets_dir) if f.endswith((".mp3", ".m4a", ".wav"))]
    return {
        "presets": [{"name": f, "size": os.path.getsize(os.path.join(presets_dir, f))} for f in xml_files],
        "audio": [{"name": f, "size": os.path.getsize(os.path.join(presets_dir, f))} for f in audio_files]
    }

@app.get("/api/tiktok")
async def get_tiktok_audio(url: str):
    if not url:
        return JSONResponse({"error": "Parameter url wajib diisi."}, status_code=400)
    
    # 1. Try remote TikTok API first
    try:
        api_url = "https://am.zervida.my.id/api/tiktok?" + urllib.parse.urlencode({"url": url})
        req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            media_url = data.get("media")
            if media_url:
                out_name = f"tiktok_{uuid.uuid4().hex[:8]}.mp3"
                dest = os.path.join(UPLOADS_DIR, out_name)
                m_req = urllib.request.Request(media_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(m_req, timeout=15) as m_resp, open(dest, "wb") as fp:
                    shutil.copyfileobj(m_resp, fp)
                return {
                    "success": True,
                    "url": f"/api/photos/{out_name}",
                    "media": f"/api/photos/{out_name}",
                    "filename": out_name
                }
    except Exception as e:
        print("[TikTok API] Remote scraper error:", e)

    # 2. Fallback to local yt-dlp
    try:
        out_name = f"tiktok_{uuid.uuid4().hex[:8]}"
        dest_tpl = os.path.join(UPLOADS_DIR, f"{out_name}.%(ext)s")
        cmd = ["yt-dlp", "-x", "--audio-format", "mp3", "--postprocessor-args", "ffmpeg:-ar 44100 -ac 2 -b:a 192k", "-o", dest_tpl, url]
        res = subprocess.run(cmd, capture_output=True, timeout=30)
        final_file = os.path.join(UPLOADS_DIR, f"{out_name}.mp3")
        if os.path.exists(final_file):
            return {
                "success": True,
                "url": f"/api/photos/{out_name}.mp3",
                "media": f"/api/photos/{out_name}.mp3",
                "filename": f"{out_name}.mp3"
            }
    except Exception as e2:
        print("[TikTok API] yt-dlp error:", e2)

    return JSONResponse({"error": "Gagal mengambil audio dari link TikTok tersebut. Pastikan link publik."}, status_code=500)

@app.post("/api/extract-audio")
async def extract_audio_api(video: UploadFile = File(...)):
    try:
        ext = os.path.splitext(video.filename)[1].lower() or ".mp4"
        temp_vid = os.path.join(UPLOADS_DIR, f"temp_vid_{uuid.uuid4().hex[:8]}{ext}")
        out_name = f"audio_extracted_{uuid.uuid4().hex[:8]}.mp3"
        out_path = os.path.join(UPLOADS_DIR, out_name)
        with open(temp_vid, "wb") as buffer:
            shutil.copyfileobj(video.file, buffer)
        cmd = ["ffmpeg", "-y", "-i", temp_vid, "-vn", "-c:a", "libmp3lame", "-ar", "44100", "-ac", "2", "-b:a", "192k", out_path]
        subprocess.run(cmd, capture_output=True)
        if os.path.exists(temp_vid):
            os.remove(temp_vid)
        if os.path.exists(out_path):
            return {"success": True, "url": f"/api/photos/{out_name}", "filename": out_name}
    except Exception as e:
        print("Extract audio error:", e)
    return JSONResponse({"error": "Gagal mengekstrak audio dari video."}, status_code=500)

@app.get("/effect-index.json")
@app.get("/runtime/effect-index.json")
async def get_effect_index():
    p = os.path.join(WEB_DIR, "runtime", "effect-index.json")
    if os.path.exists(p):
        return FileResponse(p, media_type="application/json")
    return JSONResponse({"error": "effect-index.json not found"}, status_code=404)

@app.get("/shape-index.json")
@app.get("/runtime/shape-index.json")
async def get_shape_index():
    p = os.path.join(WEB_DIR, "runtime", "shape-index.json")
    if os.path.exists(p):
        return FileResponse(p, media_type="application/json")
    return JSONResponse({"error": "shape-index.json not found"}, status_code=404)

PACKAGE_CACHE_DIR = os.path.join(WEB_DIR, "runtime", "cache")
REMOTE_DOWN_MSG = ("Server perantara link Alight Motion (am.zervida.my.id) sedang nonaktif oleh pemiliknya, "
                   "sehingga link share online baru belum bisa diambil otomatis. "
                   "Silakan gunakan opsi 'Upload file preset XML' untuk langsung memuat preset tanpa tergantung pihak ketiga, "
                   "atau pilih preset contoh yang sudah terpasang di komputer.")

def _package_id_from_url(url: str):
    m = re.search(r"/p/([^/?#]+)", url or "")
    return m.group(1) if m and safe_name(m.group(1)) else None

def _cache_file(package_id: str, project: str = None) -> str:
    name = package_id if not project else f"{package_id}__{re.sub(r'[^A-Za-z0-9._-]', '_', project)}"
    return os.path.join(PACKAGE_CACHE_DIR, name + ".json")

def _save_package_cache(package_id: str, project: str, data: dict) -> None:
    try:
        os.makedirs(PACKAGE_CACHE_DIR, exist_ok=True)
        with open(_cache_file(package_id, project), "w", encoding="utf-8") as fp:
            json.dump(data, fp, ensure_ascii=False)
    except OSError as e:
        print("[cache] gagal menyimpan cache paket:", e)

def _rebuild_from_local_files(package_id: str, url: str):
    """Susun ulang respons dari berkas yang tersimpan sebelum ada cache JSON:
    media di runtime/media/<paket> + XML di runtime/presets yang SEMUA medianya ada di folder itu."""
    media_dir = os.path.join(WEB_DIR, "runtime", "media", package_id)
    presets_dir = os.path.join(WEB_DIR, "runtime", "presets")
    if not os.path.isdir(media_dir) or not os.path.isdir(presets_dir):
        return None
    files = {f for f in os.listdir(media_dir) if os.path.isfile(os.path.join(media_dir, f)) and not f.endswith(".part")}
    if not files:
        return None
    best = None
    for fname in os.listdir(presets_dir):
        if not fname.lower().endswith(".xml"):
            continue
        path = os.path.join(presets_dir, fname)
        try:
            text = open(path, encoding="utf-8").read()
        except (OSError, UnicodeDecodeError):
            continue
        used = re.findall(r'<media\s[^>]*?uri="amproj:([^"]+)"', text)
        used = [html.unescape(u) for u in used if u and u != 'null.' and not u.startswith('null')]
        if used and all(u in files for u in used):
            if best is None or os.path.getmtime(path) > best[0]:
                best = (os.path.getmtime(path), fname, text)
    if not best:
        return None
    _, fname, text = best
    tm = re.search(r'<scene[^>]*?title="([^"]*)"', text)
    title = html.unescape(tm.group(1)) if tm else fname
    media = []
    for name in sorted(files):
        media.append({
            "name": name,
            "size": os.path.getsize(os.path.join(media_dir, name)),
            "mime": mimetypes.guess_type(name)[0] or "application/octet-stream",
            "url": f"/api/link/{package_id}/media/{urllib.parse.quote(name)}",
        })
    return {
        "url": url, "xml": text, "packageId": package_id, "xmlName": fname, "offline": True,
        "meta": {"title": f"{title} - Alight Motion", "description": "Dimuat dari cache lokal (layanan remote tidak aktif)."},
        "media": media,
        "hasAudio": ("<audio" in text),
        "projects": [{"name": fname, "title": title, "characters": len(text)}],
    }

def _has_audio_track(file_path: str) -> bool:
    """Periksa apakah berkas media memiliki track audio stream (ffprobe)."""
    if not file_path or not os.path.exists(file_path):
        return True
    lower = file_path.lower()
    if any(lower.endswith(ext) for ext in ('.mp3', '.m4a', '.wav', '.aac', '.ogg', '.opus', '.flac')):
        return True
    try:
        cmd = ['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=noprint_wrappers=1', file_path]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=2)
        return bool(res.stdout.strip())
    except Exception:
        return True

def _extract_media_map_and_audio(xml_text: str, media_list: list, local_media_dir: str = None):
    """
    Analisis deklarasi XML Alight Motion dan daftar media:
    1. Bangun kamus pemetaan URI -> nama berkas fisik di ZIP.
    2. Deteksi audio preset secara akurat (termasuk soundtrack AAC di dalam berkas container video .mp4).
    """
    media_map = {}
    if not xml_text:
        return media_map, None, False, False

    for m in re.finditer(r'<media\s+([^>]+)/?>', xml_text, re.IGNORECASE):
        attrs = dict(re.findall(r'(\w+)=["\']([^"\']*)["\']', m.group(1)))
        uri = attrs.get('uri', '')
        fn = attrs.get('filename', '')
        title = attrs.get('title', '')
        label = attrs.get('label', '')
        target_fn = fn or title or label
        if uri and target_fn:
            media_map[uri] = target_fn
            clean_uri = re.sub(r'^(amproj:|am:)', '', uri)
            media_map[clean_uri] = target_fn
            base_clean = clean_uri.split('/')[-1]
            media_map[base_clean] = target_fn
            try:
                dec = urllib.parse.unquote(clean_uri)
                media_map[dec] = target_fn
                media_map[dec.split('/')[-1]] = target_fn
            except Exception:
                pass

    has_audio_tag = bool(re.search(r'<audio\s', xml_text, re.IGNORECASE))
    found_audio_item = None

    if has_audio_tag:
        m_audio = re.search(r'<audio\s+([^>]+)/?>', xml_text, re.IGNORECASE)
        audio_src = ""
        audio_label = ""
        if m_audio:
            attrs = dict(re.findall(r'(\w+)=["\']([^"\']*)["\']', m_audio.group(1)))
            audio_src = attrs.get('src', '')
            audio_label = attrs.get('label', '')

        clean_src = re.sub(r'^(amproj:|am:)', '', audio_src).split('/')[-1]
        try:
            dec_src = urllib.parse.unquote(clean_src)
        except Exception:
            dec_src = clean_src

        # Prioritas 1: Kecocokan langsung src ke nama berkas
        if clean_src:
            for m in media_list:
                m_name = m.get('name', '')
                if m_name == clean_src or m_name.lower() == clean_src.lower() or m_name == dec_src or m_name.lower() == dec_src.lower():
                    found_audio_item = m
                    break

        # Prioritas 2: Kecocokan via mediaMap
        if not found_audio_item and audio_src:
            mapped_fn = media_map.get(audio_src) or media_map.get(clean_src) or media_map.get(dec_src)
            if mapped_fn:
                for m in media_list:
                    m_name = m.get('name', '')
                    if m_name == mapped_fn or m_name.lower() == mapped_fn.lower():
                        found_audio_item = m
                        break

        # Prioritas 3: Kecocokan via label di tag <audio>
        if not found_audio_item and audio_label:
            cl = audio_label.strip().lower()
            for m in media_list:
                m_name = m.get('name', '').lower()
                if m_name == cl or cl in m_name or m_name in cl:
                    found_audio_item = m
                    break

        # Prioritas 4: File audio murni (.mp3, .m4a, .wav, .aac, .ogg)
        if not found_audio_item:
            for m in media_list:
                m_name = m.get('name', '').lower()
                mime = m.get('mime', '').lower()
                if mime.startswith('audio/') or any(m_name.endswith(ext) for ext in ('.mp3', '.m4a', '.wav', '.aac', '.ogg')):
                    found_audio_item = m
                    break

        # Prioritas 5: Berkas container video (.mp4, .mov) yang memiliki audio stream
        if not found_audio_item:
            for m in media_list:
                m_name = m.get('name', '')
                if m_name.lower().endswith(('.mp4', '.mov', '.m4v')):
                    if local_media_dir:
                        fp = os.path.join(local_media_dir, m_name)
                        if not _has_audio_track(fp):
                            continue
                    found_audio_item = m
                    break

    # PENTING UNTUK HP ANDROID & WEBVIEW:
    # Jika audio berasal dari file container video (.mp4/.mov), ekstrak menjadi berkas .audio.mp3 murni.
    # Elemen HTML5 Audio / Android WebView sering menolak atau bisu jika memutar file container video MP4.
    # File .mp3 murni 100% didukung semua WebView Android, dan ukurannya jauh lebih kecil (< 1MB vs 15-50MB).
    if found_audio_item and local_media_dir:
        package_id = os.path.basename(local_media_dir)
        found_audio_item = _extract_audio_to_mp3(package_id, found_audio_item, media_list, local_media_dir)

    has_audio_file = bool(found_audio_item)
    missing_cloud_audio = has_audio_tag and not has_audio_file

    return media_map, found_audio_item, has_audio_file, missing_cloud_audio

def _extract_audio_to_mp3(package_id: str, audio_item: dict, media_list: list, local_media_dir: str = None) -> dict:
    """
    Jika audio_item berupa container video (.mp4, .mov), ekstrak stream audionya
    menjadi berkas .mp3 murni dengan FFmpeg agar 100% kompatibel dengan elemen HTML5 Audio di Android WebView.
    """
    if not audio_item or not isinstance(audio_item, dict):
        return audio_item
    name = audio_item.get('name', '')
    if not name:
        return audio_item

    # Bila sudah file audio murni, langsung kembalikan
    if any(name.lower().endswith(ext) for ext in ('.mp3', '.m4a', '.wav', '.aac', '.ogg', '.opus', '.flac')):
        return audio_item

    if not local_media_dir:
        local_media_dir = os.path.join(WEB_DIR, "runtime", "media", package_id)

    src_path = os.path.join(local_media_dir, name)
    if not os.path.exists(src_path):
        return audio_item

    clean_base = os.path.splitext(name)[0]
    mp3_name = f"{clean_base}.audio.mp3"
    mp3_path = os.path.join(local_media_dir, mp3_name)

    if not os.path.exists(mp3_path) or os.path.getsize(mp3_path) == 0:
        try:
            cmd = ['ffmpeg', '-y', '-i', src_path, '-vn', '-acodec', 'libmp3lame', '-b:a', '192k', mp3_path]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=25, check=True)
            print(f"[audio-extract] Berhasil ekstrak stream audio MP4 ke MP3: {name} -> {mp3_name}")
        except Exception as e:
            print(f"[audio-extract] Warning ekstrak MP3 gagal ({e}), tetap gunakan {name}")
            return audio_item

    if os.path.exists(mp3_path) and os.path.getsize(mp3_path) > 0:
        mp3_item = {
            "name": mp3_name,
            "size": os.path.getsize(mp3_path),
            "mime": "audio/mpeg",
            "url": f"/api/link/{package_id}/media/{urllib.parse.quote(mp3_name)}"
        }
        # Tambahkan ke media_list jika belum ada
        if not any(m.get('name') == mp3_name for m in media_list):
            media_list.append(mp3_item)
        return mp3_item

    return audio_item

def _offline_response(url: str, project: str):
    """Hanya kembalikan data jika ada cache JSON paket yang valid."""
    package_id = _package_id_from_url(url)
    if not package_id:
        return None
    for path in ([_cache_file(package_id, project)] if project else []) + [_cache_file(package_id)]:
        if os.path.exists(path):
            try:
                data = json.load(open(path, encoding="utf-8"))
                data["offline"] = True
                xml_text = data.get("xml", "")
                media_list = data.get("media", [])
                local_dir = os.path.join(WEB_DIR, "runtime", "media", package_id)

                media_map, audio_item, has_audio_file, missing_cloud_audio = _extract_media_map_and_audio(
                    xml_text, media_list, local_media_dir=local_dir
                )

                data["mediaMap"] = media_map
                data["audioItem"] = audio_item
                data["hasAudio"] = ("<audio" in xml_text)
                data["hasAudioFile"] = has_audio_file
                data["missingCloudAudio"] = missing_cloud_audio
                return data
            except (OSError, ValueError):
                pass
    return None


def _download_gdrive_xml(url: str):
    m = re.search(r'/file/d/([a-zA-Z0-9_-]+)', url) or re.search(r'[?&]id=([a-zA-Z0-9_-]+)', url)
    if not m:
        raise ValueError('Link Google Drive tidak valid. Format: https://drive.google.com/file/d/ID/view')
    file_id = m.group(1)
    dl_url = f"https://drive.google.com/uc?export=download&id={file_id}"
    req = urllib.request.Request(dl_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        content = resp.read()
        if b'confirm=' in content:
            m_conf = re.search(r'confirm=([0-9a-zA-Z_]+)', content.decode('utf-8', errors='ignore'))
            if m_conf:
                conf_url = dl_url + f"&confirm={m_conf.group(1)}"
                req2 = urllib.request.Request(conf_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req2, timeout=30) as resp2:
                    content = resp2.read()
    xml_text = content.decode('utf-8', errors='replace')
    if "<scene" not in xml_text and "<?xml" not in xml_text:
        raise ValueError("File dari Google Drive bukan XML preset Alight Motion yang valid.")
    m_title = re.search(r'<scene[^>]*title="([^"]+)"', xml_text)
    title = m_title.group(1) if m_title else f"GDrive Preset ({file_id[:8]})"
    xml_name = f"gdrive_{file_id}.xml"
    presets_dir = os.path.join(WEB_DIR, "runtime", "presets")
    os.makedirs(presets_dir, exist_ok=True)
    with open(os.path.join(presets_dir, xml_name), "w", encoding="utf-8") as fp:
        fp.write(xml_text)
    return {
        "url": url,
        "xml": xml_text,
        "xmlName": xml_name,
        "packageId": f"gdrive_{file_id}",
        "media": [],
        "meta": {"title": title, "description": f"Preset XML diunduh langsung dari Google Drive ({len(xml_text)} karakter)."},
        "projects": [{"name": xml_name, "title": title, "characters": len(xml_text)}]
    }

def _download_direct_xml(url: str):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    with urllib.request.urlopen(req, timeout=20) as resp:
        content = resp.read()
    xml_text = content.decode('utf-8', errors='replace')
    if "<scene" not in xml_text and "<?xml" not in xml_text:
        raise ValueError("URL tersebut tidak berisi XML preset Alight Motion yang valid.")
    m_title = re.search(r'<scene[^>]*title="([^"]+)"', xml_text)
    title = m_title.group(1) if m_title else "Direct XML Preset"
    xml_name = f"direct_{uuid.uuid4().hex[:8]}.xml"
    presets_dir = os.path.join(WEB_DIR, "runtime", "presets")
    os.makedirs(presets_dir, exist_ok=True)
    with open(os.path.join(presets_dir, xml_name), "w", encoding="utf-8") as fp:
        fp.write(xml_text)
    return {
        "url": url,
        "xml": xml_text,
        "xmlName": xml_name,
        "packageId": f"direct_{uuid.uuid4().hex[:8]}",
        "media": [],
        "meta": {"title": title, "description": f"Preset XML diunduh langsung dari web ({len(xml_text)} karakter)."},
        "projects": [{"name": xml_name, "title": title, "characters": len(xml_text)}]
    }

def _get_am_share_metadata(url: str):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
        m_title = re.search(r'<meta property="og:title" content="([^"]+)"', html)
        m_desc = re.search(r'<meta property="og:description" content="([^"]+)"', html)
        m_img = re.search(r'<meta property="og:image" content="([^"]+)"', html)
        return {
            "title": m_title.group(1) if m_title else "",
            "description": m_desc.group(1) if m_desc else "",
            "thumb": m_img.group(1) if m_img else ""
        }
    except Exception:
        return None


def _prefetch_media_background(package_id: str, media_list: list):
    media_dir = os.path.join(WEB_DIR, "runtime", "media", package_id)
    os.makedirs(media_dir, exist_ok=True)
    for m in media_list:
        fname = m.get("name")
        if not fname or not safe_name(fname):
            continue
        local_path = os.path.join(media_dir, fname)
        if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
            continue
        remote_url = (f"https://am.zervida.my.id/api/link/"
                      f"{urllib.parse.quote(package_id, safe='')}/media/{urllib.parse.quote(fname, safe='')}")
        tmp_path = f"{local_path}.bg_{uuid.uuid4().hex[:6]}.part"
        try:
            req = urllib.request.Request(remote_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=45) as resp, open(tmp_path, "wb") as fp:
                shutil.copyfileobj(resp, fp)
            if not os.path.exists(local_path):
                os.replace(tmp_path, local_path)
            print(f"[media-prefetch] Berhasil mengunduh & menyimpan lokal: {fname}")
        except Exception as e:
            print(f"[media-prefetch] Skip unduh {fname}: {e}")
        finally:
            if os.path.exists(tmp_path):
                try: os.remove(tmp_path)
                except OSError: pass

def _download_am_direct_package(url: str, project: str = None) -> dict:
    """
    Mengunduh dan mengekstrak paket Alight Motion (.zip berisi XML + foto/video/audio)
    langsung dari Firebase Storage resmi Alight Creative tanpa perantara pihak ketiga.
    """
    clean_url = url.strip()
    
    # 1. Resolve redirect jika menggunakan shortlink alight.link
    if "alight.link" in clean_url or "alightcreative.com/am/share" not in clean_url:
        try:
            req_red = urllib.request.Request(clean_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            with urllib.request.urlopen(req_red, timeout=12) as r_red:
                redir_url = r_red.geturl()
                if "alightcreative.com/am/share" in redir_url:
                    clean_url = redir_url
                else:
                    html_body = r_red.read().decode('utf-8', errors='ignore')
                    found_links = re.findall(r'https?://alightcreative\.com/am/share/u/[A-Za-z0-9_-]+/p/[A-Za-z0-9_-]+', html_body)
                    if found_links:
                        clean_url = found_links[0]
        except Exception as e_red:
            print("[direct-am] Gagal resolve redirect:", e_red)

    # 2. Parse user_id dan package_id
    m = re.search(r"/am/share/u/([A-Za-z0-9_-]+)/p/([A-Za-z0-9_-]+)", clean_url)
    if not m:
        raise ValueError("Format link Alight Motion tidak valid. Format: https://alightcreative.com/am/share/u/{USER}/p/{PACKAGE}")

    user_id = m.group(1)
    package_id = m.group(2)

    # 3. Coba unduh projectfiles.zip dari Firebase Storage
    zip_bytes = None
    filenames_to_try = ("projectfiles.zip", "projectFiles.zip", "package.zip", "project.zip")
    last_err = None

    for fname in filenames_to_try:
        object_path = f"share/u/{user_id}/p/{package_id}/{fname}"
        encoded_path = urllib.parse.quote(object_path, safe="")
        storage_url = f"https://firebasestorage.googleapis.com/v0/b/alight-creative.appspot.com/o/{encoded_path}?alt=media"
        try:
            req = urllib.request.Request(
                storage_url,
                headers={
                    "User-Agent": "AlightMotion/6.2.53 (iOS; gzip)",
                    "Accept": "*/*",
                    "Accept-Encoding": "identity",
                },
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
                if data and len(data) > 0:
                    zip_bytes = data
                    print(f"[direct-am] Berhasil unduh {fname} ({len(zip_bytes)} bytes) untuk package {package_id}")
                    break
        except Exception as e:
            last_err = e
            continue

    if not zip_bytes:
        raise ValueError(f"Tidak dapat mengunduh paket Alight Motion dari cloud ({last_err}). Link mungkin telah kedaluwarsa atau dihapus.")

    # 4. Ekstrak ZIP ke runtime/media/{package_id}/ dan runtime/presets/
    import zipfile, io
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        infolist = zf.infolist()
        xml_candidates = [info for info in infolist if info.filename.lower().endswith(".xml")]
        if not xml_candidates:
            raise ValueError("Paket ZIP tidak berisi berkas deskripsi XML scene.")

        # Pilih XML utama (file XML terbesar jika ada beberapa)
        xml_candidates.sort(key=lambda info: info.file_size, reverse=True)
        main_xml_info = xml_candidates[0]
        xml_name = main_xml_info.filename
        xml_text = zf.read(xml_name).decode("utf-8", errors="replace")

        # Ekstrak judul preset
        m_title = re.search(r'<scene[^>]*title="([^"]+)"', xml_text)
        preset_title = m_title.group(1) if m_title else f"Alight Motion Preset ({package_id[:8]})"

        # Simpan XML ke runtime/presets/
        presets_dir = os.path.join(WEB_DIR, "runtime", "presets")
        os.makedirs(presets_dir, exist_ok=True)
        with open(os.path.join(presets_dir, xml_name), "w", encoding="utf-8") as fp:
            fp.write(xml_text)

        # Siapkan folder media
        media_dir = os.path.join(WEB_DIR, "runtime", "media", package_id)
        os.makedirs(media_dir, exist_ok=True)

        media_list = []
        for info in infolist:
            fn = info.filename
            if fn.endswith("/"):
                continue
            base_fn = os.path.basename(fn)
            dest_media = os.path.join(media_dir, base_fn)
            with open(dest_media, "wb") as fp:
                fp.write(zf.read(fn))

            mime, _ = mimetypes.guess_type(base_fn)
            media_list.append({
                "name": base_fn,
                "size": info.file_size,
                "mime": mime or "application/octet-stream",
                "url": f"/api/link/{package_id}/media/{urllib.parse.quote(base_fn)}",
            })

        # Ekstrak mediaMap dan deteksi audio secara komprehensif
        media_map, found_audio_item, has_audio_file, missing_cloud_audio = _extract_media_map_and_audio(
            xml_text, media_list, local_media_dir=media_dir
        )

    result = {
        "url": clean_url,
        "xml": xml_text,
        "xmlName": xml_name,
        "packageId": package_id,
        "media": media_list,
        "mediaMap": media_map,
        "hasAudio": ("<audio" in xml_text),
        "hasAudioFile": has_audio_file,
        "missingCloudAudio": missing_cloud_audio,
        "audioItem": found_audio_item,
        "meta": {
            "title": f"{preset_title} - Alight Motion",
            "description": f"Preset diunduh langsung dari Alight Creative ({len(xml_text):,} karakter XML, {len(media_list)} media)."
        },
        "projects": [{"name": xml_name, "title": preset_title, "characters": len(xml_text)}],
    }

    # Simpan ke cache lokal agar pembukaan berikutnya super instan
    _save_package_cache(package_id, project, result)
    if not project:
        _save_package_cache(package_id, None, result)

    return result


@app.get("/api/project-xml")
async def get_project_xml(url: str, project: str = None):
    if not url:
        return JSONResponse({"error": "Parameter url wajib diisi."}, status_code=400)

    url = url.strip()

    # 1. Dukungan link Google Drive langsung (bebas 100% dari pihak ketiga)
    if "drive.google.com" in url:
        try:
            data = await asyncio.to_thread(_download_gdrive_xml, url)
            return data
        except Exception as e:
            return JSONResponse({"error": f"Gagal mengunduh preset Google Drive: {str(e)}"}, status_code=400)

    # 2. Dukungan link XML langsung di web
    if (url.startswith("http://") or url.startswith("https://")) and (
        ".xml" in url or "raw.githubusercontent.com" in url or "pastebin.com/raw" in url
    ):
        try:
            data = await asyncio.to_thread(_download_direct_xml, url)
            return data
        except Exception as e:
            return JSONResponse({"error": f"Gagal mengunduh XML: {str(e)}"}, status_code=400)

    # 3. Link share resmi Alight Motion (alightcreative.com / alight.link)
    if "alightcreative.com" not in url and "alight.link" not in url:
        return JSONResponse({
            "error": "Format link tidak dikenali. Masukkan link Alight Motion (alightcreative.com/am/share/...), link Google Drive XML, atau URL XML langsung."
        }, status_code=400)

    # METODE UTAMA: Selalu prioritaskan unduh langsung paket ZIP (XML + Media) fresh dari Firebase Storage Alight Creative
    direct_error = None
    try:
        data = await asyncio.to_thread(_download_am_direct_package, url, project)
        if data and data.get("xml"):
            print(f"[project-xml] Berhasil unduh langsung dari Firebase untuk {data.get('packageId')}")
            return data
    except Exception as e_direct:
        direct_error = str(e_direct)
        print(f"[project-xml] Unduh direct Firebase Alight Creative gagal ({e_direct}), mencoba cache lokal atau remote fallback...")

    # Cek cache offline jika download direct gagal (misal link 404 atau server cloud down)
    cached = _offline_response(url, project)
    if cached:
        print(f"[project-xml] Memakai offline cache lokal fallback untuk {_package_id_from_url(url)}")
        return cached

    # Fallback: jika direct Firebase gagal dan tidak ada cache, coba remote Zervida
    def fetch_remote():
        query_params = {"url": url}
        if project:
            query_params["project"] = project
        remote_api = "https://am.zervida.my.id/api/project-xml?" + urllib.parse.urlencode(query_params)
        req = urllib.request.Request(remote_api, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        if not isinstance(data, dict) or not data.get("xml"):
            raise ValueError("respons remote tidak berisi xml")
        return data

    remote_error = None
    try:
        data = await asyncio.to_thread(fetch_remote)
        xml_name = data.get("xmlName") or f"project_{data.get('packageId', uuid.uuid4().hex[:8])}.xml"
        presets_dir = os.path.join(WEB_DIR, "runtime", "presets")
        os.makedirs(presets_dir, exist_ok=True)
        with open(os.path.join(presets_dir, xml_name), "w", encoding="utf-8") as fp:
            fp.write(data["xml"])

        package_id = data.get("packageId") or _package_id_from_url(url)
        if package_id and safe_name(package_id):
            _save_package_cache(package_id, project, data)
            if not project:
                _save_package_cache(package_id, None, data)
            if data.get("media"):
                asyncio.create_task(asyncio.to_thread(_prefetch_media_background, package_id, data["media"]))
        return data
    except Exception as e:
        remote_error = str(e)

    # Ambil metadata nama preset dari Alight Creative untuk pesan error yang ramah
    am_meta = await asyncio.to_thread(_get_am_share_metadata, url)
    preset_title = am_meta.get("title") if am_meta else None
    err_title_str = f"Preset '{preset_title}'" if preset_title else "Link Alight Motion"


    print(f"[project-xml] Semua metode gagal untuk {url}: direct={direct_error}, remote={remote_error}")
    return JSONResponse({
        "error": f"{err_title_str} tidak dapat diunduh dari cloud ({direct_error}). Pastikan link share masih aktif di aplikasi Alight Motion, atau gunakan link Google Drive XML.",
        "meta": am_meta
    }, status_code=400)

@app.get("/api/effect-xml")
async def get_effect_xml(id: str = ""):
    short_id = id.split('.')[-1]
    for candidate in [f"{id}.xml", f"{short_id}.xml", f"{short_id.lower()}.xml"]:
        local_path = os.path.join(WEB_DIR, "effects", candidate)
        if os.path.exists(local_path):
            return FileResponse(local_path, media_type="application/xml")
    return Response(content='<?xml version="1.0" encoding="utf-8"?><effect/>', media_type="application/xml")

@app.get("/effects/{filename}")
async def get_effects_file(filename: str):
    p = os.path.join(WEB_DIR, "effects", filename)
    if os.path.exists(p):
        return FileResponse(p, media_type="application/xml")
    return Response(content='<?xml version="1.0" encoding="utf-8"?><effect/>', media_type="application/xml")

@app.get("/api/link/{package_id}/media/{filename}")
async def get_package_media(package_id: str, filename: str):
    if not safe_name(package_id) or not safe_name(filename):
        return JSONResponse({"error": "Invalid path"}, status_code=400)
    media_dir = os.path.join(WEB_DIR, "runtime", "media", package_id)
    os.makedirs(media_dir, exist_ok=True)
    local_path = os.path.join(media_dir, filename)
    
    if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
        return FileResponse(local_path)
    
    remote_url = (f"https://am.zervida.my.id/api/link/"
                  f"{urllib.parse.quote(package_id, safe='')}/media/{urllib.parse.quote(filename, safe='')}")

    def download():
        tmp_path = f"{local_path}.req_{uuid.uuid4().hex[:6]}.part"
        try:
            req = urllib.request.Request(remote_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=60) as resp, open(tmp_path, "wb") as fp:
                shutil.copyfileobj(resp, fp)
            if not os.path.exists(local_path):
                os.replace(tmp_path, local_path)
        finally:
            if os.path.exists(tmp_path):
                try: os.remove(tmp_path)
                except OSError: pass

    try:
        await asyncio.to_thread(download)
        if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
            return FileResponse(local_path)
    except Exception as e:
        print(f"[get_package_media] Unduh remote {filename} gagal: {e}")

    # Media tidak ada & tidak bisa diunduh: balas 404 yang jujur. Sebelumnya server menyajikan berkas
    # PENGGANTI (foto1.jpg / audio.m4a) dengan status 200, sehingga foto, video, dan musik link tidak sesuai aslinya.
    print(f"[get_package_media] media tidak tersedia: {package_id}/{filename}")
    return JSONResponse({"error": "Media not found"}, status_code=404)

def run_render_task(foto1_name: str, foto2_name: str, foto3_name: str = None, crop_configs: dict = None, preset: str = "1"):
    global render_state
    try:
        with render_lock:
            render_state["status"] = "rendering"
            render_state["progress"] = 0
            render_state["error"] = None

        p1 = os.path.join(UPLOADS_DIR, foto1_name) if foto1_name else os.path.join(BASE_DIR, "foto1.jpg")
        p2 = os.path.join(UPLOADS_DIR, foto2_name) if foto2_name else os.path.join(BASE_DIR, "foto2.jpg")
        p3 = os.path.join(UPLOADS_DIR, foto3_name) if foto3_name and os.path.exists(os.path.join(UPLOADS_DIR, foto3_name)) else (os.path.join(BASE_DIR, "foto3.jpg") if os.path.exists(os.path.join(BASE_DIR, "foto3.jpg")) else p1)

        if preset == "3":
            prefix = "jj3"
            desktop_output = os.path.join(BASE_DIR, "hasil_jedag_jedug3.mp4")
        elif preset == "2":
            prefix = "jj2"
            desktop_output = os.path.join(BASE_DIR, "hasil_jedag_jedug2.mp4")
        else:
            prefix = "jj1"
            desktop_output = os.path.join(BASE_DIR, "hasil_jedag_jedug.mp4")

        out_name = f"{prefix}_render_{uuid.uuid4().hex[:6]}.mp4"
        out_path = os.path.join(OUTPUT_DIR, out_name)

        def update_pct(pct):
            with render_lock:
                render_state["progress"] = pct

        if preset == "3":
            render_jj3.render_full_video3(
                foto1_path=p1,
                foto2_path=p2,
                foto3_path=p3,
                output_path=out_path,
                progress_callback=update_pct,
                crop_configs=crop_configs
            )
        elif preset == "2":
            render_jj2.render_full_video2(
                foto1_path=p1,
                foto2_path=p2,
                foto3_path=p3,
                output_path=out_path,
                progress_callback=update_pct,
                crop_configs=crop_configs
            )
        else:
            render_jj.render_full_video(
                foto1_path=p1,
                foto2_path=p2,
                foto3_path=p3,
                output_path=out_path,
                progress_callback=update_pct,
                crop_configs=crop_configs
            )

        shutil.copy(out_path, desktop_output)
        if preset == "1":
            shutil.copy(out_path, os.path.join(BASE_DIR, "hasil_jedag_jedug.mp4"))

        with render_lock:
            render_state["status"] = "done"
            render_state["progress"] = 100
            render_state["video_name"] = out_name

    except Exception as e:
        with render_lock:
            render_state["status"] = "error"
            render_state["error"] = str(e)
            print(f"[RenderError] {e}")

@app.post("/api/render")
async def trigger_render(
    background_tasks: BackgroundTasks,
    foto1: str = Form(...),
    foto2: str = Form(...),
    foto3: str = Form(None),
    crop_json: str = Form(None),
    preset: str = Form("1")
):
    global render_state
    with render_lock:
        if render_state["status"] == "rendering":
            return JSONResponse({"error": "Render already in progress"}, status_code=400)
        render_state["status"] = "rendering"
        render_state["progress"] = 0
        render_state["error"] = None

    crop_configs = {}
    if crop_json:
        try:
            crop_configs = json.loads(crop_json)
        except Exception as e:
            print("crop_json parse error:", e)

    background_tasks.add_task(run_render_task, foto1, foto2, foto3, crop_configs, preset)
    return {"status": "started"}

@app.get("/api/progress")
async def get_progress():
    with render_lock:
        return {
            "status": render_state["status"],
            "progress": render_state["progress"],
            "error": render_state["error"],
            "video_url": f"/api/download/{render_state['video_name']}" if render_state["status"] == "done" else None
        }

@app.get("/api/download/{video_name}")
async def download_video(video_name: str):
    if not safe_name(video_name):
        return JSONResponse({"error": "Invalid filename"}, status_code=400)
    file_path = os.path.join(OUTPUT_DIR, video_name)
    if "jj3" in video_name:
        dl_name = "hasil_jedag_jedug3.mp4"
    elif "jj2" in video_name:
        dl_name = "hasil_jedag_jedug2.mp4"
    else:
        dl_name = "hasil_jedag_jedug.mp4"

    if os.path.exists(file_path):
        return FileResponse(file_path, media_type="video/mp4", filename=dl_name)
    # Fallback to desktop outputs
    for fallback in [dl_name, "hasil_jedag_jedug3.mp4", "hasil_jedag_jedug2.mp4", "hasil_jedag_jedug.mp4"]:
        p = os.path.join(BASE_DIR, fallback)
        if os.path.exists(p):
            return FileResponse(p, media_type="video/mp4", filename=fallback)
    return JSONResponse({"error": "Video not found"}, status_code=404)

# Serve web directory
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

import os
import sys
import math
import subprocess
import xml.etree.ElementTree as ET
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

# =====================================================================
# CONFIGURATION & CONSTANTS
# =====================================================================
DEFAULT_OUTPUT = "c:/Users/Hype/Desktop/xprest/hasil_jedag_jedug.mp4"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_AUDIO = os.path.join(BASE_DIR, "audio.m4a")
XML_PATH = "c:/Users/Hype/Desktop/xprest/#685.xml"
DEFAULT_FOTO1 = "c:/Users/Hype/Desktop/xprest/foto1.jpg"
DEFAULT_FOTO2 = "c:/Users/Hype/Desktop/xprest/foto2.jpg"

W, H = 720, 1280
H2 = H // 2
FPS = 60
TOTAL_TIME_MS = 18915
TOTAL_FRAMES = int((TOTAL_TIME_MS / 1000.0) * FPS) # 1134 frames

# =====================================================================
# FONTS SETUP
# =====================================================================
font_candidates = [
    "C:/Windows/Fonts/Roboto-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/segoeuib.ttf"
]
font_path_bold = None
for f in font_candidates:
    if os.path.exists(f):
        font_path_bold = f
        break

font_roboto = ImageFont.truetype(font_path_bold, 54) if font_path_bold else ImageFont.load_default()
font_padamu = ImageFont.truetype(font_path_bold, 44) if font_path_bold else ImageFont.load_default()

# =====================================================================
# EXACT ALIGHT MOTION EASING EVALUATOR (Newton-Raphson Bezier Solver)
# =====================================================================
def eval_cubic_bezier(x1, y1, x2, y2, p):
    p = np.clip(p, 0.0, 1.0)
    t = p
    for _ in range(20):
        bx = 3.0 * (1.0 - t)**2 * t * x1 + 3.0 * (1.0 - t) * t**2 * x2 + t**3
        dbx = 3.0 * (1.0 - t)**2 * x1 + 6.0 * (1.0 - t) * t * (x2 - x1) + 3.0 * t**2 * (1.0 - x2)
        diff = bx - p
        if abs(diff) < 1e-6:
            break
        if abs(dbx) > 1e-6:
            t = np.clip(t - diff / dbx, 0.0, 1.0)
        else:
            break
    by = 3.0 * (1.0 - t)**2 * t * y1 + 3.0 * (1.0 - t) * t**2 * y2 + t**3
    return by

def eval_easing(e_str, p):
    p = np.clip(p, 0.0, 1.0)
    if not e_str or e_str == 'None':
        return p
    if e_str.startswith('cubicBezier'):
        parts = [float(x) for x in e_str.split()[1:]]
        return eval_cubic_bezier(parts[0], parts[1], parts[2], parts[3], p)
    if 'elastic' in e_str:
        if p == 0: return 0.0
        if p == 1: return 1.0
        return math.sin(-13.0 * (math.pi / 2.0) * (p + 1.0)) * math.pow(2.0, -10.0 * p) + 1.0
    return p

def interpolate_kfs(kfs, t):
    if len(kfs) == 0: return 0.0
    if len(kfs) == 1: return kfs[0][1]
    if t <= kfs[0][0]: return kfs[0][1]
    if t >= kfs[-1][0]: return kfs[-1][1]
    for i in range(len(kfs) - 1):
        t0, v0, e0 = kfs[i]
        t1, v1, e1 = kfs[i+1]
        if t0 <= t <= t1:
            if t1 == t0: return v0
            p = (t - t0) / (t1 - t0)
            u = eval_easing(e1, p)
            if isinstance(v0, (list, tuple, np.ndarray)):
                return np.array(v0) + u * (np.array(v1) - np.array(v0))
            return v0 + u * (v1 - v0)
    return kfs[-1][1]

# =====================================================================
# XML SHAPE MODEL (Exact AM Parameter Parser)
# =====================================================================
class AMShape:
    def __init__(self, elem):
        self.id = elem.attrib.get('id')
        self.label = elem.attrib.get('label')
        self.start = float(elem.attrib.get('startTime', 0))
        self.end = float(elem.attrib.get('endTime', 0))
        self.dur = self.end - self.start
        self.media = elem.attrib.get('fillImage', '')
        self.parent = elem.attrib.get('parent')
        
        self.scale_kfs = []
        self.loc_kfs = []
        self.rot_kfs = []
        self.opacity_kfs = []
        self.effects = []
        
        xf = elem.find('transform')
        if xf is not None:
            for p in xf:
                kfs = p.findall('kf')
                if p.tag == 'scale':
                    if kfs:
                        for kf in kfs:
                            t = float(kf.attrib.get('t'))
                            vals = [float(x) for x in kf.attrib.get('v').split(',')]
                            e = kf.attrib.get('e', '')
                            self.scale_kfs.append((t, vals, e))
                        self.scale_kfs.sort(key=lambda x: x[0])
                    elif p.attrib.get('value'):
                        vals = [float(x) for x in p.attrib.get('value').split(',')]
                        self.scale_kfs = [(0.0, vals, '')]
                elif p.tag == 'location':
                    if kfs:
                        for kf in kfs:
                            t = float(kf.attrib.get('t'))
                            vals = [float(x) for x in kf.attrib.get('v').split(',')]
                            e = kf.attrib.get('e', '')
                            self.loc_kfs.append((t, vals, e))
                        self.loc_kfs.sort(key=lambda x: x[0])
                    elif p.attrib.get('value'):
                        vals = [float(x) for x in p.attrib.get('value').split(',')]
                        self.loc_kfs = [(0.0, vals, '')]
                elif p.tag == 'rotation':
                    if kfs:
                        for kf in kfs:
                            t = float(kf.attrib.get('t'))
                            val = float(kf.attrib.get('v'))
                            e = kf.attrib.get('e', '')
                            self.rot_kfs.append((t, val, e))
                        self.rot_kfs.sort(key=lambda x: x[0])
                    elif p.attrib.get('value'):
                        self.rot_kfs = [(0.0, float(p.attrib.get('value')), '')]
                elif p.tag == 'opacity':
                    if kfs:
                        for kf in kfs:
                            t = float(kf.attrib.get('t'))
                            val = float(kf.attrib.get('v'))
                            e = kf.attrib.get('e', '')
                            self.opacity_kfs.append((t, val, e))
                        self.opacity_kfs.sort(key=lambda x: x[0])
                    elif p.attrib.get('value'):
                        self.opacity_kfs = [(0.0, float(p.attrib.get('value')), '')]
                        
        for eff in elem.findall('effect'):
            eid = eff.attrib.get('id')
            props = {}
            for p in eff.findall('property'):
                pname = p.attrib.get('name')
                kfs = p.findall('kf')
                if kfs:
                    pkfs = []
                    for kf in kfs:
                        t = float(kf.attrib.get('t'))
                        v = float(kf.attrib.get('v'))
                        e = kf.attrib.get('e', '')
                        pkfs.append((t, v, e))
                    pkfs.sort(key=lambda x: x[0])
                    props[pname] = pkfs
                else:
                    v_str = p.attrib.get('value')
                    try:
                        props[pname] = float(v_str)
                    except:
                        props[pname] = v_str
            self.effects.append((eid, props))

    def eval_transform(self, ms, beat_start_ms=None):
        if self.dur <= 0:
            rel_t = 0.0
        else:
            rel_t = (ms - self.start) / self.dur
            
        # Scale
        if self.scale_kfs:
            sx, sy = interpolate_kfs(self.scale_kfs, rel_t)
        else:
            sx, sy = 1.0, 1.0
            
        # Rotation
        if self.rot_kfs:
            rot = interpolate_kfs(self.rot_kfs, rel_t)
        else:
            rot = 0.0
            
        # Location
        if self.loc_kfs:
            loc = interpolate_kfs(self.loc_kfs, rel_t)
            lx = loc[0]
            ly = loc[1]
            if abs(lx - 540.0) < 1.0 and abs(ly - 960.0) < 1.0:
                lx = 0.0
                ly = 0.0
            elif abs(ly - 960.0) < 1.0:
                ly = 0.0
        else:
            lx, ly = 0.0, 0.0
            
        s_coord = W / 1080.0
        lx_scaled = lx * s_coord
        ly_scaled = ly * s_coord
        
        # Opacity
        if self.opacity_kfs:
            op = interpolate_kfs(self.opacity_kfs, rel_t)
        else:
            op = 1.0
            
        # Oscillate displacement calculated strictly from beat_start
        # Prevents phase teleportation and creates 100% smooth continuous motion
        osc_dx = 0.0
        osc_dy = 0.0
        origin_t = beat_start_ms if beat_start_ms is not None else self.start
        t_sec = max(0.0, (ms - origin_t) / 1000.0)
        flip_angle = 0.0
        
        for eid, props in self.effects:
            if eid == 'com.alightcreative.effects.oscillate3':
                freq = float(props.get('freq', 1.0))
                phase = float(props.get('phase', 0.0))
                
                ang_prop = props.get('angle', 0.0)
                if isinstance(ang_prop, list):
                    ang_deg = interpolate_kfs(ang_prop, rel_t)
                else:
                    ang_deg = float(ang_prop)
                    
                mag_prop = props.get('mag', 0.0)
                if isinstance(mag_prop, list):
                    mag = interpolate_kfs(mag_prop, rel_t)
                else:
                    mag = float(mag_prop)
                    
                theta = 2.0 * math.pi * freq * t_sec + phase
                disp = mag * math.sin(theta) * s_coord
                rad = math.radians(ang_deg)
                osc_dx += disp * math.cos(rad)
                osc_dy += disp * math.sin(rad)
                
            elif eid == 'com.alightcreative.effects.flip3':
                ang_prop = props.get('angle', 0.0)
                if isinstance(ang_prop, list):
                    flip_angle = interpolate_kfs(ang_prop, rel_t)
                else:
                    flip_angle = float(ang_prop)
                    
        return {
            'scale': (sx, sy),
            'rot': rot,
            'loc': (lx_scaled, ly_scaled),
            'opacity': op,
            'osc': (osc_dx, osc_dy),
            'flip3': flip_angle
        }

# Load XML structure
tree = ET.parse(XML_PATH)
root_elem = tree.getroot()
shapes_dict = {c.attrib['id']: AMShape(c) for c in root_elem if c.tag == 'shape'}

# 16 XML Beat Bookmark partitions (9341ms to 16908ms)
# Maps each beat 1-to-1 to its respective XML Shape ID without overlapping delays
BEAT_MAP = [
    ( 9341, 10041, '2000009688', 1), # Beat 1 (Foto 1)
    (10041, 10525, '2000009684', 1), # Beat 2 (Foto 1)
    (10525, 10758, '2000009685', 1), # Beat 3 (Foto 1)
    (10758, 11241, '2000009686', 1), # Beat 4 (Foto 1, Tilt)
    (11241, 11941, '2000009687', 1), # Beat 5 (Foto 1, Mirror Leap)
    (11941, 12408, '2000009694', 1), # Beat 6 (Foto 1, Leap 1)
    (12408, 12658, '2000009695', 1), # Beat 7 (Foto 1, Leap 2)
    (12658, 13125, '2000009696', 1), # Beat 8 (Foto 1, Leap 3)
    (13125, 13808, '2000009689', 2), # Beat 9 (Foto 2 Entrance)
    (13808, 14308, '2000009690', 2), # Beat 10 (Foto 2 Zoom 1.49x)
    (14308, 14541, '2000009691', 2), # Beat 11 (Foto 2 Punch 1.52x)
    (14541, 15025, '2000009692', 2), # Beat 12 (Foto 2 Drop 0.78x)
    (15025, 15725, '2000009693', 2), # Beat 13 (Foto 2 3D Flip 1)
    (15725, 16208, '2000009697', 2), # Beat 14 (Foto 2 3D Flip 2)
    (16208, 16425, '2000009698', 2), # Beat 15 (Foto 2 3D Flip 3)
    (16425, 16908, '2000009699', 2)  # Beat 16 (Foto 2 3D Flip 4 & Outro)
]

# =====================================================================
# 2-LAYAR IMAGE BASE BUILDER
# =====================================================================
def make_half_screen(img, offset_x=0.0, offset_y=0.0, zoom=1.0):
    ih, iw = img.shape[:2]
    zoom = max(1.0, float(zoom))
    base_scale = max(W / float(iw), H2 / float(ih))
    scale = base_scale * zoom
    nw, nh = int(round(iw * scale)), int(round(ih * scale))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LANCZOS4)
    
    half = np.zeros((H2, W, 3), dtype=np.uint8)
    
    draw_x = int(round((W - nw) / 2.0 + offset_x))
    draw_y = int(round((H2 - nh) / 2.0 + offset_y))
    
    src_x1 = max(0, -draw_x)
    src_y1 = max(0, -draw_y)
    src_x2 = min(nw, W - draw_x)
    src_y2 = min(nh, H2 - draw_y)
    
    dst_x1 = max(0, draw_x)
    dst_y1 = max(0, draw_y)
    dst_x2 = dst_x1 + (src_x2 - src_x1)
    dst_y2 = dst_y1 + (src_y2 - src_y1)
    
    if src_x2 > src_x1 and src_y2 > src_y1:
        half[dst_y1:dst_y2, dst_x1:dst_x2] = resized[src_y1:src_y2, src_x1:src_x2]
    return half

def build_2layar_base(img, offset_x=0.0, offset_y=0.0, zoom=1.0):
    half = make_half_screen(img, offset_x, offset_y, zoom)
    base = np.vstack([half, half])
    # Crisp Alight Motion dividing seam lines
    cv2.line(base, (0, H2), (W, H2), (10, 10, 10), 2)
    cv2.line(base, (0, H2+1), (W, H2+1), (230, 230, 230), 1)
    return base

# =====================================================================
# ACCURATE MOTION BLUR & TRANSFORMS
# =====================================================================
def apply_motion_blur_subtle(img, dx, dy):
    speed = math.hypot(dx, dy)
    if speed < 4.0:
        return img
    ksize = min(11, max(3, int(speed * 0.12)))
    if ksize % 2 == 0:
        ksize += 1
    if ksize < 3:
        return img
    angle = math.atan2(dy, dx)
    kernel = np.zeros((ksize, ksize), dtype=np.float32)
    center = ksize // 2
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    for i in range(ksize):
        offset = i - center
        x = int(round(center + offset * cos_a))
        y = int(round(center + offset * sin_a))
        if 0 <= x < ksize and 0 <= y < ksize:
            kernel[y, x] = 1.0
    ksum = kernel.sum()
    if ksum > 0:
        kernel /= ksum
        return cv2.filter2D(img, -1, kernel)
    return img

def render_transformed_frame(base_img, sx, sy, rot_deg, dx, dy, flip_angle, v_dx=0.0, v_dy=0.0):
    flip_x = False
    if sx < 0:
        flip_x = True
        sx = abs(sx)
        
    canvas = base_img.copy()
    if flip_x:
        canvas = cv2.flip(canvas, 1)
        
    # 3D Flip angle around Y axis with clean white canvas background
    if abs(flip_angle) > 1.0:
        rad = math.radians(flip_angle)
        cos_f = math.cos(rad)
        f_sign = 1.0 if cos_f >= 0 else -1.0
        scale_x_3d = max(0.01, abs(cos_f))
        
        src_pts = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
        skew_y = (1.0 - scale_x_3d) * 45.0
        cx = W / 2.0
        hw = (W / 2.0) * scale_x_3d
        
        dst_pts = np.float32([
            [cx - hw, skew_y],
            [cx + hw, -skew_y],
            [cx + hw, H + skew_y],
            [cx - hw, H - skew_y]
        ])
        M_p = cv2.getPerspectiveTransform(src_pts, dst_pts)
        canvas = cv2.warpPerspective(canvas, M_p, (W, H), borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
        if f_sign < 0:
            canvas = cv2.flip(canvas, 1)

    # 2D Affine Transform (Rotation, Scale, Translation) with white canvas border
    cx, cy = W / 2.0, H / 2.0
    M = cv2.getRotationMatrix2D((cx, cy), rot_deg, sx)
    M[0, 2] += dx
    M[1, 2] += dy
    
    transformed = cv2.warpAffine(canvas, M, (W, H), borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
    
    # Apply velocity-based shutter motion blur
    transformed = apply_motion_blur_subtle(transformed, v_dx, v_dy)
    
    # CC Sharpen (strength=0.44, radius=1.0 from XML shape 53)
    blur_sharpen = cv2.GaussianBlur(transformed, (0, 0), 1.0)
    crisp = cv2.addWeighted(transformed, 1.44, blur_sharpen, -0.44, 0)
    
    return crisp

# =====================================================================
# FULL VIDEO RENDER PIPELINE
# =====================================================================
def render_full_video(foto1_path=DEFAULT_FOTO1, foto2_path=DEFAULT_FOTO2, foto3_path=None, output_path=DEFAULT_OUTPUT, progress_callback=None, crop_configs=None):
    if crop_configs is None:
        crop_configs = {}
    c1 = crop_configs.get('foto1', {})
    c2 = crop_configs.get('foto2', {})
    c3 = crop_configs.get('foto3', {})

    img1_raw = cv2.imread(foto1_path)
    img2_raw = cv2.imread(foto2_path)
    img3_raw = cv2.imread(foto3_path) if foto3_path and os.path.exists(foto3_path) else img2_raw
    
    if img1_raw is None or img2_raw is None:
        raise ValueError(f"Failed to load images from {foto1_path} or {foto2_path}")
        
    base_f1 = build_2layar_base(img1_raw, offset_x=c1.get('x', 0), offset_y=c1.get('y', 0), zoom=c1.get('zoom', 1.0))
    base_f2 = build_2layar_base(img2_raw, offset_x=c2.get('x', 0), offset_y=c2.get('y', 0), zoom=c2.get('zoom', 1.0))
    base_f3 = build_2layar_base(img3_raw, offset_x=c3.get('x', 0), offset_y=c3.get('y', 0), zoom=c3.get('zoom', 1.0)) if img3_raw is not None else base_f2
    
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{W}x{H}",
        "-pix_fmt", "bgr24",
        "-r", str(FPS),
        "-i", "-",
        "-i", DEFAULT_AUDIO,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        output_path
    ]
    
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    for idx in range(TOTAL_FRAMES):
        ms = (idx / float(FPS)) * 1000.0
        
        # -------------------------------------------------------------
        # SEGMEN 1: Intro Kinetic Typography (0 - 4533 ms)
        # -------------------------------------------------------------
        if ms < 4533:
            frame = np.ones((H, W, 3), dtype=np.uint8) * 255
            pil_img = Image.fromarray(frame)
            draw = ImageDraw.Draw(pil_img)
            
            y_dip = 0
            if ms >= 3733:
                p_dip = (ms - 3733) / (4533 - 3733)
                y_dip = int(55.0 * eval_cubic_bezier(0.5, 1.0, 0.0, 1.0, p_dip))
                
            color_text = (15, 15, 15)
            
            # Line 1: "jangan"
            if ms < 617:
                bbox = draw.textbbox((0, 0), "jangan", font=font_roboto)
                tw = bbox[2] - bbox[0]
                draw.text(((W - tw)//2, H//2 - 40), "jangan", font=font_roboto, fill=color_text)
            else:
                draw.text((210, 490 + y_dip), "jangan", font=font_roboto, fill=color_text)
                
            # Line 2 & 3
            if ms >= 617:
                draw.text((210, 590 + y_dip), "harap", font=font_roboto, fill=color_text)
                
            if ms >= 2500:
                draw.text((450, 590 + y_dip), "ku", font=font_roboto, fill=color_text)
                draw.text((210, 690 + y_dip), "kan", font=font_roboto, fill=color_text)
                draw.text((410, 690 + y_dip), "kembali", font=font_roboto, fill=color_text)
            elif ms >= 1984:
                draw.text((210, 690 + y_dip), "ku", font=font_roboto, fill=color_text)
                draw.text((450, 690 + y_dip), "kan", font=font_roboto, fill=color_text)
            elif ms >= 1650:
                draw.text((210, 690 + y_dip), "ku", font=font_roboto, fill=color_text)
                
            frame = np.array(pil_img)
            
        # -------------------------------------------------------------
        # SEGMEN 2: Pre-Drop Glitch (4533 - 4641 ms)
        # -------------------------------------------------------------
        elif ms < 4641:
            if ms < 4584:
                small = cv2.resize(base_f1, (W//8, H//8))
                pix = cv2.resize(small, (W, H), interpolation=cv2.INTER_NEAREST)
                tint = np.zeros_like(pix)
                tint[:, :] = (50, 65, 195)
                frame = cv2.addWeighted(pix, 0.45, tint, 0.55, 0)
            else:
                b, g, r = cv2.split(base_f1)
                r = np.roll(r, -20, axis=1)
                b = np.roll(b, 20, axis=1)
                frame = cv2.merge([b, g, r])
                p_fl = (4641 - ms) / (4641 - 4584)
                white = np.ones_like(frame) * 255
                frame = cv2.addWeighted(frame, 1.0 - p_fl*0.75, white, p_fl*0.75, 0)

        # -------------------------------------------------------------
        # SEGMEN 3: Foto 1 (2 Layar) + "padamu" Reveal (4641 - 6750 ms)
        # -------------------------------------------------------------
        elif ms < 6750:
            dt = (ms - 4641) / 1000.0
            sway_deg = 3.3 * math.sin(2.0 * math.pi * 1.8 * dt)
            dy_sway = 20.0 * math.sin(2.0 * math.pi * 1.8 * dt)
            scale_sway = 1.08 + 0.04 * math.cos(2.0 * math.pi * 0.9 * dt)
            
            cx, cy = W / 2.0, H / 2.0
            M = cv2.getRotationMatrix2D((cx, cy), sway_deg, scale_sway)
            M[1, 2] += dy_sway
            frame = cv2.warpAffine(base_f1, M, (W, H), borderMode=cv2.BORDER_REFLECT)
            
            if ms < 4900:
                p_fl = (4900 - ms) / 260.0
                white = np.ones_like(frame) * 255
                frame = cv2.addWeighted(frame, 1.0 - p_fl*0.65, white, p_fl*0.65, 0)
                
            full_word = "padamu"
            p_rev = min(1.0, (ms - 4641) / 1600.0)
            num_c = max(1, int(p_rev * len(full_word) + 0.9))
            curr_word = full_word[:num_c]
            
            pil_img = Image.fromarray(frame)
            draw = ImageDraw.Draw(pil_img)
            bbox = draw.textbbox((0, 0), curr_word, font=font_padamu)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            tx = (W - tw) // 2
            ty = H2 - th // 2 - 5
            
            for ox in [-3, -2, 0, 2, 3]:
                for oy in [-3, -2, 0, 2, 3]:
                    draw.text((tx + ox, ty + oy), curr_word, font=font_padamu, fill=(0, 0, 0))
            draw.text((tx, ty), curr_word, font=font_padamu, fill=(255, 255, 255))
            frame = np.array(pil_img)

        # -------------------------------------------------------------
        # SEGMEN 4: Smooth 2-Column Slide Transition (6750 - 9341 ms)
        # -------------------------------------------------------------
        elif ms < 9341:
            dt = (ms - 6750) / 1000.0
            sway_deg = 2.5 * math.sin(2.0 * math.pi * 1.5 * dt)
            dy_sway = 15.0 * math.sin(2.0 * math.pi * 1.5 * dt)
            
            if ms < 8841:
                p_slide = min(1.0, (ms - 6750) / 1525.0)
                u_slide = eval_cubic_bezier(0.87, 0.0, 0.21, 1.0, p_slide)
                w_col1 = int(W - (W // 2) * u_slide)
                w_col2 = W - w_col1
                
                canvas = np.zeros((H, W, 3), dtype=np.uint8)
                canvas[:, 0:w_col1] = cv2.resize(base_f1, (w_col1, H))
                if w_col2 > 0:
                    canvas[:, w_col1:W] = cv2.resize(base_f1, (w_col2, H))
                    
                cv2.line(canvas, (w_col1, 0), (w_col1, H), (20, 20, 20), 2)
                cv2.line(canvas, (w_col1 + 1, 0), (w_col1 + 1, H), (255, 255, 255), 1)
                cv2.line(canvas, (0, H2), (W, H2), (20, 20, 20), 2)
                cv2.line(canvas, (0, H2 + 1), (W, H2 + 1), (255, 255, 255), 1)
                
                cx, cy = W / 2.0, H / 2.0
                M = cv2.getRotationMatrix2D((cx, cy), sway_deg, 1.06)
                M[1, 2] += dy_sway
                frame = cv2.warpAffine(canvas, M, (W, H), borderMode=cv2.BORDER_REFLECT)
                
                if ms < 7441:
                    p_fade = (7441 - ms) / 691.0
                    c_alpha = int(255 * p_fade)
                    pil_img = Image.fromarray(frame)
                    draw = ImageDraw.Draw(pil_img)
                    bbox = draw.textbbox((0, 0), "padamu", font=font_padamu)
                    tw = bbox[2] - bbox[0]
                    th = bbox[3] - bbox[1]
                    tx = (W - tw) // 2
                    ty = H2 - th // 2 - 5
                    for ox in [-2, 0, 2]:
                        for oy in [-2, 0, 2]:
                            draw.text((tx + ox, ty + oy), "padamu", font=font_padamu, fill=(0, 0, 0))
                    draw.text((tx, ty), "padamu", font=font_padamu, fill=(c_alpha, c_alpha, c_alpha))
                    frame = np.array(pil_img)
            else:
                p_expand = (ms - 8841) / (9341 - 8841)
                u_expand = eval_cubic_bezier(0.91, 0.0, 0.58, 1.0, p_expand)
                w_col1 = int((W // 2) * (1.0 - u_expand))
                w_col2 = W - w_col1
                
                canvas = np.zeros((H, W, 3), dtype=np.uint8)
                if w_col1 > 0:
                    canvas[:, 0:w_col1] = cv2.resize(base_f1, (w_col1, H))
                canvas[:, w_col1:W] = cv2.resize(base_f1, (w_col2, H))
                
                cv2.line(canvas, (0, H2), (W, H2), (20, 20, 20), 2)
                cv2.line(canvas, (0, H2 + 1), (W, H2 + 1), (255, 255, 255), 1)
                
                cx, cy = W / 2.0, H / 2.0
                M = cv2.getRotationMatrix2D((cx, cy), sway_deg, 1.06)
                M[1, 2] += dy_sway
                frame = cv2.warpAffine(canvas, M, (W, H), borderMode=cv2.BORDER_REFLECT)

        # -------------------------------------------------------------
        # SEGMEN 5: EXACT XML JEDAG-JEDUG (9341 - 16908 ms)
        # -------------------------------------------------------------
        elif ms < 16908:
            active_b = None
            for b in BEAT_MAP:
                if b[0] <= ms < b[1]:
                    active_b = b
                    break
            if active_b is None:
                active_b = BEAT_MAP[-1]
                
            t_start, t_end, s_id, foto_idx = active_b
            s = shapes_dict[s_id]
            res = s.eval_transform(ms, t_start)
            
            if foto_idx == 1:
                base_img = base_f1
            elif foto_idx == 2:
                # If Foto 3 is provided and we are on the final 3D flips (Beats 14-16), use Foto 3
                if ms >= 15725 and foto3_path and os.path.exists(foto3_path):
                    base_img = base_f3
                else:
                    base_img = base_f2
            else:
                base_img = base_f3
                
            sx, sy = res['scale']
            rot = res['rot']
            dx = res['loc'][0] + res['osc'][0]
            dy = res['loc'][1] + res['osc'][1]
            flip_angle = res['flip3']
            opacity = res['opacity']
            
            # Velocity difference vector for shutter motion blur
            res_prev = s.eval_transform(ms - 16.67, t_start)
            v_dx = (dx - (res_prev['loc'][0] + res_prev['osc'][0]))
            v_dy = (dy - (res_prev['loc'][1] + res_prev['osc'][1]))
            
            frame = render_transformed_frame(base_img, sx, sy, rot, dx, dy, flip_angle, v_dx=v_dx, v_dy=v_dy)
            
            # Opacity fade at end of beat 16 (16658 - 16908 ms)
            if opacity < 1.0:
                white = np.ones_like(frame) * 255
                frame = cv2.addWeighted(frame, opacity, white, 1.0 - opacity, 0)

        # -------------------------------------------------------------
        # SEGMEN 6: Outro (16908 - 18915 ms)
        # -------------------------------------------------------------
        else:
            frame = np.ones((H, W, 3), dtype=np.uint8) * 255
            
        proc.stdin.write(frame.tobytes())
        
        if progress_callback and idx % 15 == 0:
            pct = int((idx + 1) / float(TOTAL_FRAMES) * 100.0)
            progress_callback(pct)
            
    proc.stdin.close()
    proc.wait()
    if progress_callback:
        progress_callback(100)
    print(f"[RenderEngine] Successfully generated: {output_path}")

def main():
    print("=" * 60)
    print("ALIGHT MOTION XML #685 RENDERER (STUDIO QUALITY 60FPS)")
    print("=" * 60)
    def print_progress(pct):
        print(f"\rProgress: {pct:3d}%", end="", flush=True)
    render_full_video(progress_callback=print_progress)
    print("\nDone!")

if __name__ == "__main__":
    main()

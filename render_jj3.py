import os
import sys
import math
import subprocess
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

from render_jj import (
    W, H, H2, FPS, BASE_DIR,
    eval_cubic_bezier, eval_easing, interpolate_kfs,
    make_half_screen, build_2layar_base,
    font_padamu, font_roboto
)
from preset3_data import TOTAL_TIME_MS3, FPS3, BEAT_BOOKMARKS3, SEGMENTS3

# =====================================================================
# PRESET 3: "#682 - Stelan Cuek"
# Exact 60 FPS Python Engine & 2-Layar Compositor
# =====================================================================
DEFAULT_AUDIO3 = os.path.join(BASE_DIR, "audio3.m4a")
DEFAULT_OUTPUT3 = os.path.join(BASE_DIR, "hasil_jedag_jedug3.mp4")
TOTAL_FRAMES3 = int((TOTAL_TIME_MS3 / 1000.0) * FPS3) # 912 frames
S_COORD = W / 1080.0

# Fonts setup for text overlays in preset 3
font_candidates = [
    "C:/Windows/Fonts/Roboto-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/segoeuib.ttf"
]
font_bold_path = None
for f in font_candidates:
    if os.path.exists(f):
        font_bold_path = f
        break

font_nona = ImageFont.truetype(font_bold_path, 98) if font_bold_path else ImageFont.load_default()
font_nona_small = ImageFont.truetype(font_bold_path, 52) if font_bold_path else ImageFont.load_default()
font_stecu = ImageFont.truetype(font_bold_path, 104) if font_bold_path else ImageFont.load_default()
font_sub = ImageFont.truetype(font_bold_path, 20) if font_bold_path else ImageFont.load_default()
font_seam = ImageFont.truetype(font_bold_path, 42) if font_bold_path else ImageFont.load_default()
font_aduhay = ImageFont.truetype(font_bold_path, 50) if font_bold_path else ImageFont.load_default()

def interp_kfs_dict(kfs_list, rel_t, default_val=1.0):
    if not kfs_list:
        return default_val
    if len(kfs_list) == 1:
        return kfs_list[0]['v']
    
    sorted_kfs = sorted(kfs_list, key=lambda x: x['t'])
    if rel_t <= sorted_kfs[0]['t']:
        return sorted_kfs[0]['v']
    if rel_t >= sorted_kfs[-1]['t']:
        return sorted_kfs[-1]['v']
        
    for i in range(len(sorted_kfs) - 1):
        kf0 = sorted_kfs[i]
        kf1 = sorted_kfs[i + 1]
        t0, v0, e0 = kf0['t'], kf0['v'], kf0.get('e', 'None')
        t1, v1, e1 = kf1['t'], kf1['v'], kf1.get('e', 'None')
        if t0 <= rel_t <= t1:
            if t1 == t0:
                return v0
            p = (rel_t - t0) / float(t1 - t0)
            u = eval_easing(e1, p)
            if isinstance(v0, (list, tuple, np.ndarray)):
                return [v0[idx] + u * (v1[idx] - v0[idx]) for idx in range(len(v0))]
            return v0 + u * (v1 - v0)
    return sorted_kfs[-1]['v']

def get_segment_at(ms):
    # Segment 0: 0 - 1300 ms (Intro)
    if ms < 1300:
        return 0, SEGMENTS3[0], 0
    # Segment 1: 1300 - 5016 ms (Foto 1)
    if ms < 5016:
        return 1, SEGMENTS3[1], 1
    # Segments 2 to 11: 5016 - 9133 ms (Foto 2)
    if ms < 9133:
        for idx in range(2, 12):
            seg = SEGMENTS3[idx]
            if seg['start'] <= ms < seg['end']:
                return idx, seg, 2
        return 11, SEGMENTS3[11], 2
    # Segments 12 to 21: 9133 - 13266 ms (Foto 3)
    if ms < 13266:
        for idx in range(12, 22):
            seg = SEGMENTS3[idx]
            if seg['start'] <= ms < seg['end']:
                return idx, seg, 3
        return 21, SEGMENTS3[21], 3
    # Outro: 13266 - 15215 ms (Foto 3 hold / fade)
    return 21, SEGMENTS3[21], 3

def render_frame_p3(ms, base1, base2, base3):
    """
    Renders a single frame at timestamp `ms` with exact transforms.
    """
    if ms < 1300:
        # Intro: Clean retro background with kinetic typography "nona" & "stecu"
        frame = np.ones((H, W, 3), dtype=np.uint8) * 255
        
        # PIL text draw
        img_pil = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(img_pil)
        
        t_sec = ms / 1000.0
        swing_angle = -1.5 + 3.0 * 0.5 * (1.0 + math.sin(2.0 * math.pi * 2.0 * t_sec))
        cx, cy = W // 2, H // 2
        
        if ms < 650:
            # "nona" pop bounce (clean deep black)
            p_in = min(1.0, ms / 220.0)
            text_main = "nona"
            bbox = draw.textbbox((0, 0), text_main, font=font_nona)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            draw.text((cx - tw // 2, cy - th // 2), text_main, font=font_nona, fill=(0, 0, 0))
        else:
            # "nona" upper neutral gray
            text_upper = "nona"
            bbox_u = draw.textbbox((0, 0), text_upper, font=font_nona_small)
            tw_u = bbox_u[2] - bbox_u[0]
            draw.text((cx - tw_u // 2, cy - 80), text_upper, font=font_nona_small, fill=(100, 100, 110))
            
            # "stecu" center punch (clean deep black)
            text_main = "stecu"
            bbox = draw.textbbox((0, 0), text_main, font=font_stecu)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            draw.text((cx - tw // 2, cy + 20), text_main, font=font_stecu, fill=(0, 0, 0))
            
        frame = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
        
        # Swing tilt
        if abs(swing_angle) > 0.05:
            M_rot = cv2.getRotationMatrix2D((cx, cy), swing_angle, 1.0)
            frame = cv2.warpAffine(frame, M_rot, (W, H), borderValue=(255, 255, 255))
        return frame

    seg_idx, seg, foto_num = get_segment_at(ms)
    
    # Select base canvas based on photo number
    if foto_num == 1:
        source_canvas = base1
    elif foto_num == 2:
        source_canvas = base2
    else:
        source_canvas = base3

    # Calculate relative progress in this segment
    dur = max(1.0, float(seg['end'] - seg['start']))
    rel_t = (ms - seg['start']) / dur
    
    # Extract Transform (Scale, Location, Rotation)
    t_data = seg.get('transform', {})
    sc_val = t_data.get('scale')
    if isinstance(sc_val, list):
        sc = interp_kfs_dict(sc_val, rel_t, default_val=[1.0, 1.0])
    elif isinstance(sc_val, (int, float)):
        sc = [float(sc_val), float(sc_val)]
    else:
        sc = [1.0, 1.0]

    sx = float(sc[0]) if isinstance(sc, list) else float(sc)
    sy = float(sc[1]) if isinstance(sc, list) and len(sc) > 1 else sx
    
    rot_val = t_data.get('rotation')
    if isinstance(rot_val, list):
        rot = float(interp_kfs_dict(rot_val, rel_t, default_val=0.0))
    elif isinstance(rot_val, (int, float)):
        rot = float(rot_val)
    else:
        rot = 0.0

    # Extract Location & Oscillate
    loc_val = t_data.get('location')
    if isinstance(loc_val, list) and len(loc_val) > 0 and isinstance(loc_val[0], dict):
        loc = interp_kfs_dict(loc_val, rel_t, default_val=[540.0, 960.0])
    elif isinstance(loc_val, list) and len(loc_val) >= 2:
        loc = [float(loc_val[0]), float(loc_val[1])]
    else:
        loc = [540.0, 960.0]
        
    dx = (loc[0] - 540.0) * S_COORD
    dy = (loc[1] - 960.0) * S_COORD

    # Effects: Oscillate & 3D Flip
    eff_data = seg.get('effects', {})
    osc_dx, osc_dy = 0.0, 0.0
    
    if 'oscillate3' in eff_data:
        o_props = eff_data['oscillate3']
        freq = float(o_props.get('freq', 0.86))
        mag_prop = o_props.get('mag', 81.0)
        mag = float(interp_kfs_dict(mag_prop, rel_t, 81.0)) if isinstance(mag_prop, list) else float(mag_prop)
        
        ang_prop = o_props.get('angle', -90.0)
        ang = float(interp_kfs_dict(ang_prop, rel_t, -90.0)) if isinstance(ang_prop, list) else float(ang_prop)
        
        t_sec = max(0.0, (ms - seg['start']) / 1000.0)
        theta = 2.0 * math.pi * freq * t_sec
        disp = mag * math.sin(theta) * S_COORD
        rad = math.radians(ang)
        osc_dx += disp * math.cos(rad)
        osc_dy += disp * math.sin(rad)

    flip_angle = 0.0
    if 'flip3' in eff_data:
        f_props = eff_data['flip3']
        ang_prop = f_props.get('angle', 0.0)
        flip_angle = float(interp_kfs_dict(ang_prop, rel_t, 0.0)) if isinstance(ang_prop, list) else float(ang_prop)

    # Apply 2D Scale + Rotation + Translation Affine Matrix
    cx, cy = W / 2.0, H / 2.0
    total_dx = dx + osc_dx
    total_dy = dy + osc_dy
    
    # Mirroring check
    is_mirror = (sx < 0)
    abs_sx = abs(sx)
    
    # 3D Flip scaling projection
    flip_rad = math.radians(flip_angle)
    flip_cos = math.cos(flip_rad)
    scale_x_3d = abs(flip_cos)
    if flip_cos < 0:
        is_mirror = not is_mirror

    # Warp affine
    M = cv2.getRotationMatrix2D((cx, cy), -rot, 1.0)
    M[0, 0] *= ( -1.0 if is_mirror else 1.0 ) * abs_sx * scale_x_3d
    M[0, 1] *= ( -1.0 if is_mirror else 1.0 ) * abs_sx * scale_x_3d
    M[1, 0] *= sy
    M[1, 1] *= sy
    M[0, 2] += total_dx
    M[1, 2] += total_dy

    frame = cv2.warpAffine(source_canvas, M, (W, H), borderMode=cv2.BORDER_REFLECT)

    # Draw center seam text overlay
    img_pil = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(img_pil)
    
    if foto_num == 1:
        if ms < 2900:
            # 1.3s – 2.9s: "stelan cuek" (Clean white text with black outline, exactly like reference)
            t_scene = ms - 1300.0
            
            img_pil = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            draw = ImageDraw.Draw(img_pil)
            
            text_stelan = "stelan"
            text_cuek = "cuek"
            
            bbox_s = draw.textbbox((0, 0), text_stelan, font=font_seam)
            w_s = bbox_s[2] - bbox_s[0]
            h_s = bbox_s[3] - bbox_s[1]
            
            bbox_c = draw.textbbox((0, 0), text_cuek, font=font_seam)
            w_c = bbox_c[2] - bbox_c[0]
            h_c = bbox_c[3] - bbox_c[1]
            
            gap = 20
            total_w = w_s + gap + w_c
            start_x = cx - total_w // 2
            
            # Draw "stelan" (white with crisp black stroke)
            draw.text((start_x, H2 - h_s // 2 - 2), text_stelan, font=font_seam, fill=(255, 255, 255), stroke_width=3, stroke_fill=(0, 0, 0))
            
            # Draw "cuek" if t_scene >= 433ms
            if t_scene >= 433:
                draw.text((start_x + w_s + gap, H2 - h_c // 2 - 2), text_cuek, font=font_seam, fill=(255, 255, 255), stroke_width=3, stroke_fill=(0, 0, 0))
                
            frame = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
        else:
            # 2.9s – 5.01s: "aduhayy" leading to Drop Beat!
            # Semi-transparent dark strip behind center seam
            overlay = frame.copy()
            cv2.rectangle(overlay, (0, H2 - 32), (W, H2 + 32), (0, 0, 0), -1)
            frame = cv2.addWeighted(overlay, 0.42, frame, 0.58, 0)
            
            img_pil = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            draw = ImageDraw.Draw(img_pil)
            
            seam_text = "aduhayy"
            bbox = draw.textbbox((0, 0), seam_text, font=font_aduhay)
            stw = bbox[2] - bbox[0]
            sth = bbox[3] - bbox[1]
            
            # Bold pure white text with black outline
            draw.text((cx - stw // 2, H2 - sth // 2 - 2), seam_text, font=font_aduhay, fill=(255, 255, 255), stroke_width=4, stroke_fill=(0, 0, 0))
            frame = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
        
        # Pre-drop white flash (4950ms - 5016ms)
        if 4950 <= ms < 5016:
            p_flash = (ms - 4950.0) / 66.0
            white = np.ones_like(frame) * 255
            frame = cv2.addWeighted(frame, 1.0 - p_flash * 0.75, white, p_flash * 0.75, 0)

    # CATATAN: Watermark "#abilprikitiw", "9:16", dan bio watermark telah dihapus total dari Foto 2 & Foto 3.

    # Outro Fade (13266ms - 15215ms)
    if ms > 13266:
        p_fade = min(1.0, max(0.0, (ms - 13266.0) / 1949.0))
        black = np.zeros_like(frame)
        frame = cv2.addWeighted(frame, 1.0 - p_fade * 0.75, black, p_fade * 0.75, 0)

    return frame

def render_video(foto1_path=None, foto2_path=None, foto3_path=None, output_path=None, progress_callback=None, transforms=None, crop_configs=None):
    if foto1_path is None or not os.path.exists(foto1_path):
        foto1_path = os.path.join(BASE_DIR, "foto1.jpg")
    if foto2_path is None or not os.path.exists(foto2_path):
        foto2_path = os.path.join(BASE_DIR, "foto2.jpg")
    if foto3_path is None or not os.path.exists(foto3_path):
        foto3_path = foto1_path
    if output_path is None:
        output_path = DEFAULT_OUTPUT3

    # Load photos
    img1 = cv2.imread(foto1_path)
    img2 = cv2.imread(foto2_path)
    img3 = cv2.imread(foto3_path) if foto3_path and os.path.exists(foto3_path) else img1

    cfg = crop_configs if crop_configs is not None else (transforms or {})
    tf1 = cfg.get('foto1', {})
    tf2 = cfg.get('foto2', {})
    tf3 = cfg.get('foto3', {})

    base1 = build_2layar_base(img1, tf1.get('x', 0), tf1.get('y', 0), tf1.get('zoom', 1.0))
    base2 = build_2layar_base(img2, tf2.get('x', 0), tf2.get('y', 0), tf2.get('zoom', 1.0))
    base3 = build_2layar_base(img3, tf3.get('x', 0), tf3.get('y', 0), tf3.get('zoom', 1.0))

    audio_file = DEFAULT_AUDIO3 if os.path.exists(DEFAULT_AUDIO3) else os.path.join(BASE_DIR, "audio.m4a")

    cmd = [
        'ffmpeg', '-y',
        '-f', 'rawvideo',
        '-vcodec', 'rawvideo',
        '-s', f'{W}x{H}',
        '-pix_fmt', 'bgr24',
        '-r', str(FPS3),
        '-i', '-',
        '-i', audio_file,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        output_path
    ]

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    for i in range(TOTAL_FRAMES3):
        ms = (i / float(FPS3)) * 1000.0
        frame = render_frame_p3(ms, base1, base2, base3)
        proc.stdin.write(frame.tobytes())

        if progress_callback and (i % 15 == 0 or i == TOTAL_FRAMES3 - 1):
            pct = int((i + 1) / float(TOTAL_FRAMES3) * 100.0)
            progress_callback(pct)

    proc.stdin.close()
    proc.wait()
    if progress_callback:
        progress_callback(100)
    return output_path

render_full_video3 = render_video

if __name__ == "__main__":
    print("Testing render_jj3.py...")
    def print_progress(pct):
        print(f"Render progress: {pct}%", flush=True)
    out = render_video(progress_callback=print_progress)
    print("Render complete! Saved to:", out, flush=True)

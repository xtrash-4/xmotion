import os
import math
import subprocess
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

from render_jj import (
    W, H, H2, FPS, BASE_DIR,
    eval_easing,
    build_2layar_base, render_transformed_frame,
    font_padamu, font_roboto
)
from preset2_data import (
    TOTAL_TIME_MS2, FPS2,
    INTRO2_PHRASES, BEAT_MAP2,
    TRACK_F1_SCALE, TRACK_F1_LOC, TRACK_F1_FLIP,
    TRACK_NOL3_SCALE, TRACK_NOL3_LOC,
    TRACK_F2_SCALE, TRACK_F2_LOC, TRACK_F2_FLIP,
    TRACK_NOL1_SCALE, TRACK_NOL1_LOC,
    TRACK_NOL2_SCALE, TRACK_NOL2_LOC, TRACK_NOL2_ROT
)

# =====================================================================
# PRESET 2: "kannxue | pelukan yang hangat"
# 100% Exact Alight Motion Reconstructor Engine (60 FPS)
# =====================================================================
DEFAULT_AUDIO2 = os.path.join(BASE_DIR, "audio2.m4a")
TOTAL_FRAMES2 = int((TOTAL_TIME_MS2 / 1000.0) * FPS) # 1020 frames
S_COORD = W / 1080.0

# Load sticker if present
STICKER_PATH = os.path.join(BASE_DIR, "preset 2", "emoji_sticker.png")
sticker_img = cv2.imread(STICKER_PATH) if os.path.exists(STICKER_PATH) else None

def interp_abs(kfs, t, default_val=None):
    if not kfs:
        return default_val
    if t <= kfs[0][0]:
        return kfs[0][1]
    if t >= kfs[-1][0]:
        return kfs[-1][1]
    for i in range(len(kfs) - 1):
        t0, v0, e0 = kfs[i]
        t1, v1, e1 = kfs[i + 1]
        if t0 <= t <= t1:
            if t1 == t0:
                return v0
            p = (t - t0) / float(t1 - t0)
            u = eval_easing(e1, p)
            if isinstance(v0, (list, tuple, np.ndarray)):
                return np.array(v0) + u * (np.array(v1) - np.array(v0))
            return v0 + u * (v1 - v0)
    return kfs[-1][1]

def eval_transform_at2(ms):
    """
    Computes exact Alight Motion composited transform for any ms timestamp.
    Returns dictionary with scale, location, rotation, and 3D flip angle.
    """
    if ms < 7800:
        return None

    # Find active beat
    active_b = None
    for b in BEAT_MAP2:
        if b[0] <= ms < b[1]:
            active_b = b
            break
    if active_b is None:
        if ms < 8258:
            active_b = (7800, 8258, 1)
        else:
            active_b = BEAT_MAP2[-1]

    b_st, b_et, foto_idx = active_b
    b_dur = b_et - b_st
    t_sec = max(0.0, (ms - b_st) / 1000.0)

    # Child beat oscillate (freq=0.86 Hz, mag=62 -> 0, angle=90 -> -90)
    p_osc = min(1.0, max(0.0, (ms - b_st) / (0.93985 * b_dur))) if b_dur > 0 else 1.0
    mag_c = 62.0 * (1.0 - p_osc)
    ang_c = 90.0 - 180.0 * p_osc
    disp_c = mag_c * math.sin(2.0 * math.pi * 0.86 * t_sec) * S_COORD
    osc_cx = disp_c * math.cos(math.radians(ang_c))
    osc_cy = disp_c * math.sin(math.radians(ang_c))

    if ms < 11841:
        # FOTO 1 TRACKS
        sc_c = interp_abs(TRACK_F1_SCALE, ms, [1.0, 1.0])
        loc_c = interp_abs(TRACK_F1_LOC, ms, [0.0, 0.0])
        flip_c = interp_abs(TRACK_F1_FLIP, ms, 0.0)

        # Parent: Nol 3 (8250 - 11849)
        if 8250 <= ms <= 11849:
            sc_p = interp_abs(TRACK_NOL3_SCALE, ms, [1.0, 1.0])
            loc_p = interp_abs(TRACK_NOL3_LOC, ms, [0.0, 0.0])
            t_sec_p = (ms - 8250.0) / 1000.0
            disp_p = 47.0 * math.sin(2.0 * math.pi * 1.25 * t_sec_p) * S_COORD
            ang_p = 45.0 + 45.0 * min(1.0, (ms - 8250.0) / 3599.0)
            osc_px = disp_p * math.cos(math.radians(ang_p))
            osc_py = disp_p * math.sin(math.radians(ang_p))
        else:
            sc_p = [1.0, 1.0]
            loc_p = [0.0, 0.0]
            osc_px, osc_py = 0.0, 0.0

        sx = sc_c[0] * sc_p[0]
        sy = sc_c[1] * sc_p[1]
        dx = loc_c[0] * S_COORD + osc_cx + loc_p[0] * S_COORD + osc_px
        dy = loc_c[1] * S_COORD + osc_cy + loc_p[1] * S_COORD + osc_py
        rot = 0.0
        flip = flip_c
        return {'foto': 1, 'sx': sx, 'sy': sy, 'dx': dx, 'dy': dy, 'rot': rot, 'flip': flip}

    else:
        # FOTO 2 TRACKS
        sc_c = interp_abs(TRACK_F2_SCALE, ms, [1.0, 0.832])
        loc_c = interp_abs(TRACK_F2_LOC, ms, [0.0, 0.0])
        flip_c = interp_abs(TRACK_F2_FLIP, ms, 0.0)

        rot_p = 0.0
        if ms < 13641:
            # Parent: Nol 1 (11833 - 13649)
            sc_p = interp_abs(TRACK_NOL1_SCALE, ms, [1.0, 1.0])
            loc_p = interp_abs(TRACK_NOL1_LOC, ms, [0.0, 0.0])
            t_sec_p = (ms - 11833.0) / 1000.0
            disp_p = 47.0 * math.sin(2.0 * math.pi * 1.25 * t_sec_p) * S_COORD
            ang_p = 45.0 + 45.0 * min(1.0, (ms - 11833.0) / 1816.0)
            osc_px = disp_p * math.cos(math.radians(ang_p))
            osc_py = disp_p * math.sin(math.radians(ang_p))
        else:
            # Parent: Nol 2 (13633 - 15432)
            sc_p = interp_abs(TRACK_NOL2_SCALE, ms, [1.0, 1.0])
            loc_p = interp_abs(TRACK_NOL2_LOC, ms, [0.0, 0.0])
            rot_p = interp_abs(TRACK_NOL2_ROT, ms, 0.0)
            t_sec_p = (ms - 13633.0) / 1000.0
            disp_p = 47.0 * math.sin(2.0 * math.pi * 1.25 * t_sec_p) * S_COORD
            ang_p = 45.0 + 45.0 * min(1.0, (ms - 13633.0) / 1799.0)
            osc_px = disp_p * math.cos(math.radians(ang_p))
            osc_py = disp_p * math.sin(math.radians(ang_p))

        sx = sc_c[0] * sc_p[0]
        sy = sc_c[1] * sc_p[1]
        dx = loc_c[0] * S_COORD + osc_cx + loc_p[0] * S_COORD + osc_px
        dy = loc_c[1] * S_COORD + osc_cy + loc_p[1] * S_COORD + osc_py
        rot = rot_p
        flip = flip_c
        return {'foto': 2, 'sx': sx, 'sy': sy, 'dx': dx, 'dy': dy, 'rot': rot, 'flip': flip}


def render_intro2_frame(ms):
    """
    Renders the exact intro sequence: white background, centered kinetic typography with soft shadow,
    and center crying emoji sticker from 4000ms to 7800ms.
    """
    frame = np.ones((H, W, 3), dtype=np.uint8) * 255
    pil_img = Image.fromarray(frame)
    draw = ImageDraw.Draw(pil_img)

    # 1. Center animated crying emoji (4000ms - 7800ms)
    if 4000 <= ms < 7800 and sticker_img is not None:
        p_stk = min(1.0, (ms - 4000) / 300.0)
        stk_scale = 0.55 * eval_easing('cubicBezier 0.42 0.0 0.58 1.0', p_stk)
        sw = int(sticker_img.shape[1] * stk_scale)
        sh = int(sticker_img.shape[0] * stk_scale)
        if sw > 0 and sh > 0:
            stk_resized = cv2.resize(sticker_img, (sw, sh), interpolation=cv2.INTER_LANCZOS4)
            sx0 = (W - sw) // 2
            sy0 = (H - sh) // 2
            # Paste sticker on white canvas
            frame[sy0:sy0+sh, sx0:sx0+sw] = stk_resized
            pil_img = Image.fromarray(frame)
            draw = ImageDraw.Draw(pil_img)

    # 2. Text phrases
    phrase = next((p for p in INTRO2_PHRASES if p[0] <= ms < p[1]), None)
    if phrase is not None:
        start, end, text = phrase
        local_t = ms - start
        dur = end - start

        # Smooth pop-in and fade-out
        pop_dur = 160.0
        fade_dur = 140.0
        alpha = 1.0
        scale = 1.0
        if local_t < pop_dur:
            p = local_t / pop_dur
            u = 1.0 - (1.0 - p) ** 3
            scale = 0.85 + 0.15 * u
            alpha = u
        elif local_t > dur - fade_dur:
            alpha = max(0.0, (dur - local_t) / fade_dur)

        font_use = font_roboto if font_roboto else ImageFont.load_default()
        bbox = draw.textbbox((0, 0), text, font=font_use)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = (W - tw) // 2
        ty = (H - th) // 2

        # Soft drop shadow
        shadow_alpha = int(80 * alpha)
        for ox in [-2, -1, 1, 2]:
            for oy in [-2, -1, 1, 2]:
                draw.text((tx + ox, ty + oy), text, font=font_use, fill=(180, 180, 180))

        # Main text (black)
        text_color = int((1.0 - alpha) * 255)
        draw.text((tx, ty), text, font=font_use, fill=(text_color, text_color, text_color))

    return np.array(pil_img)


def render_full_video2(foto1_path, foto2_path, foto3_path=None, output_path=None,
                        progress_callback=None, crop_configs=None):
    """
    Renders complete 17.015s 60 FPS studio quality MP4 video for Preset 2.
    """
    if crop_configs is None:
        crop_configs = {}
    c1 = crop_configs.get('foto1', {})
    c2 = crop_configs.get('foto2', {})

    img1_raw = cv2.imread(foto1_path)
    img2_raw = cv2.imread(foto2_path)
    if img1_raw is None or img2_raw is None:
        raise ValueError(f"Failed to load images from {foto1_path} or {foto2_path}")

    base_f1 = build_2layar_base(img1_raw, offset_x=c1.get('x', 0), offset_y=c1.get('y', 0), zoom=c1.get('zoom', 1.0))
    base_f2 = build_2layar_base(img2_raw, offset_x=c2.get('x', 0), offset_y=c2.get('y', 0), zoom=c2.get('zoom', 1.0))

    if output_path is None:
        output_path = os.path.join(BASE_DIR, "hasil_jedag_jedug2.mp4")

    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{W}x{H}",
        "-pix_fmt", "bgr24",
        "-r", str(FPS),
        "-i", "-",
        "-i", DEFAULT_AUDIO2,
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

    prev_dx = 0.0
    prev_dy = 0.0

    for idx in range(TOTAL_FRAMES2):
        ms = (idx / float(FPS)) * 1000.0

        # -------------------------------------------------------------
        # SEGMEN 1: Intro Kinetic Typography & Sticker (0 - 7800 ms)
        # -------------------------------------------------------------
        if ms < 7800:
            frame = render_intro2_frame(ms)
            prev_dx = 0.0
            prev_dy = 0.0

        # -------------------------------------------------------------
        # SEGMEN 2: Buildup Zoom-In Card (7800 - 8258 ms)
        # -------------------------------------------------------------
        elif ms < 8258:
            tr = eval_transform_at2(ms)
            v_dx = tr['dx'] - prev_dx
            v_dy = tr['dy'] - prev_dy
            prev_dx = tr['dx']
            prev_dy = tr['dy']
            frame = render_transformed_frame(
                base_f1, tr['sx'], tr['sy'], tr['rot'], tr['dx'], tr['dy'], tr['flip'],
                v_dx=v_dx, v_dy=v_dy
            )

        # -------------------------------------------------------------
        # SEGMEN 3: Transition Overlap Between Foto 1 and Foto 2 (11600 - 11841 ms)
        # -------------------------------------------------------------
        elif 11600 <= ms < 11841:
            # Foto 1 slides left:
            tr1 = eval_transform_at2(ms)
            v_dx1 = tr1['dx'] - prev_dx
            v_dy1 = tr1['dy'] - prev_dy
            prev_dx = tr1['dx']
            prev_dy = tr1['dy']
            frame1 = render_transformed_frame(
                base_f1, tr1['sx'], tr1['sy'], tr1['rot'], tr1['dx'], tr1['dy'], tr1['flip'],
                v_dx=v_dx1, v_dy=v_dy1
            )

            # Foto 2 slides in from right:
            p_tr = (ms - 11600.0) / (11841.0 - 11600.0)
            u_tr = eval_easing('cubicBezier 0.72 0.0 1.0 1.0', p_tr)
            sx2 = u_tr
            sy2 = 0.8322
            dx2 = (1.0 - u_tr) * 543.34 * S_COORD
            frame2 = render_transformed_frame(
                base_f2, sx2, sy2, 0.0, dx2, 0.0, 0.0,
                v_dx=-15.0, v_dy=0.0
            )

            # Geometric composite of Foto 2 over Foto 1 based on Foto 2's bounding box
            x_left = max(0, int(round(W / 2.0 + dx2 - (W / 2.0) * sx2)))
            x_right = min(W, int(round(W / 2.0 + dx2 + (W / 2.0) * sx2)))
            frame = frame1.copy()
            if x_right > x_left:
                frame[:, x_left:x_right] = frame2[:, x_left:x_right]

        # -------------------------------------------------------------
        # SEGMEN 4: Jedag-Jedug Main Beats (8258 - 15033 ms)
        # -------------------------------------------------------------
        elif ms < 15033:
            tr = eval_transform_at2(ms)
            base_img = base_f1 if tr['foto'] == 1 else base_f2

            v_dx = tr['dx'] - prev_dx
            v_dy = tr['dy'] - prev_dy
            prev_dx = tr['dx']
            prev_dy = tr['dy']

            frame = render_transformed_frame(
                base_img, tr['sx'], tr['sy'], tr['rot'], tr['dx'], tr['dy'], tr['flip'],
                v_dx=v_dx, v_dy=v_dy
            )

        # -------------------------------------------------------------
        # SEGMEN 5: Beat 20 with Solid White Fade (15033 - 15425 ms)
        # -------------------------------------------------------------
        elif ms < 15425:
            tr = eval_transform_at2(ms)
            v_dx = tr['dx'] - prev_dx
            v_dy = tr['dy'] - prev_dy
            prev_dx = tr['dx']
            prev_dy = tr['dy']

            frame = render_transformed_frame(
                base_f2, tr['sx'], tr['sy'], tr['rot'], tr['dx'], tr['dy'], tr['flip'],
                v_dx=v_dx, v_dy=v_dy
            )

            # Fade to solid white (Shape 23: opacity 0 -> 1.0)
            p_fade = min(1.0, max(0.0, (ms - 15033.0) / (15425.0 - 15033.0)))
            white = np.ones_like(frame) * 255
            frame = cv2.addWeighted(frame, 1.0 - p_fade, white, p_fade, 0)

        # -------------------------------------------------------------
        # SEGMEN 6: Outro Solid White (15425 - 17015 ms)
        # -------------------------------------------------------------
        else:
            frame = np.ones((H, W, 3), dtype=np.uint8) * 255

        proc.stdin.write(frame.tobytes())

        if progress_callback and idx % 15 == 0:
            pct = int((idx + 1) / float(TOTAL_FRAMES2) * 100.0)
            progress_callback(pct)

    proc.stdin.close()
    proc.wait()
    if progress_callback:
        progress_callback(100)
    print(f"[RenderEngine2] Successfully generated: {output_path}")

def main():
    print("=" * 60)
    print("ALIGHT MOTION PRESET 2 RENDERER (PELUKAN YANG HANGAT)")
    print("=" * 60)
    def print_progress(pct):
        print(f"\rProgress: {pct:3d}%", end="", flush=True)
    render_full_video2(
        foto1_path=os.path.join(BASE_DIR, "foto1.jpg"),
        foto2_path=os.path.join(BASE_DIR, "foto2.jpg"),
        output_path=os.path.join(BASE_DIR, "hasil_jedag_jedug2.mp4"),
        progress_callback=print_progress
    )
    print("\nDone!")

if __name__ == "__main__":
    main()

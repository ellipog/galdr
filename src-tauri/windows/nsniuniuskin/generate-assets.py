import os
from PIL import Image, ImageDraw, ImageFont

SKIN = os.path.join(os.path.dirname(__file__), "skin")
FORM = os.path.join(SKIN, "form")
PUBLIC = os.path.join(SKIN, "public")
BTN = os.path.join(PUBLIC, "btn")
CHK = os.path.join(PUBLIC, "checkbox")
CAP = os.path.join(PUBLIC, "caption")
BK = os.path.join(PUBLIC, "bk")
VSCROLL = os.path.join(PUBLIC, "vsrcollbar")
EDIT = os.path.join(PUBLIC, "edit")

W = 508
H = 418

# Galdr monochrome palette
BG = "#000000"
BG_DIM = "#111111"
FG = "#c8c8c8"
FG_DIM = "#6a6a6a"
FG_FAINT = "#262626"
FG_FAINTER = "#1a1a1a"

FONT_PATH = "C:\\Windows\\Fonts\\consola.ttf"
FONT_BOLD = "C:\\Windows\\Fonts\\consolab.ttf"

def font(size, bold=False):
    p = FONT_BOLD if bold else FONT_PATH
    try:
        return ImageFont.truetype(p, size)
    except:
        try:
            return ImageFont.truetype("C:\\Windows\\Fonts\\cour.ttf", size)
        except:
            return ImageFont.load_default()

def rounded_rect(draw, xy, radius, fill, outline=None):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline)

def make_button(w, h, name_prefix="btn"):
    """App-style button: outlined normal, filled FG on hover, filled FG_DIM pressed.

    All three states are always visible (never fully transparent) so the button
    is clearly readable on the black installer background.
    """
    r = min(w, h) // 6

    # Normal: filled BG_DIM with a visible FG border
    img_n = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img_n)
    rounded_rect(draw, (0, 0, w - 1, h - 1), r, BG_DIM, FG)
    img_n.save(os.path.join(BTN, f"{name_prefix}_normal.png"))

    # Hover: filled FG with dark text
    img_h = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img_h)
    rounded_rect(draw, (0, 0, w - 1, h - 1), r, FG, FG)
    img_h.save(os.path.join(BTN, f"{name_prefix}_hover.png"))

    # Pressed: filled FG_FAINTER (subtle depression)
    img_p = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img_p)
    rounded_rect(draw, (0, 0, w - 1, h - 1), r, FG_FAINTER, FG_DIM)
    img_p.save(os.path.join(BTN, f"{name_prefix}_pressed.png"))

def make_caption_btn(size, icon="close"):
    """Caption buttons: subtle always-visible glyph, bright fill on hover/press."""
    pad = size // 3

    # Normal: faint glyph so the button is discoverable, no fill
    img_n = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img_n)
    _draw_caption_glyph(draw, icon, size, pad, FG_DIM)
    img_n.save(os.path.join(CAP, f"{icon}_normal.png"))

    # Hover: filled background + bright glyph
    img_h = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img_h)
    bg_hover = "#8b0000" if icon == "close" else BG_DIM
    rounded_rect(draw, (0, 0, size - 1, size - 1), 4, bg_hover)
    _draw_caption_glyph(draw, icon, size, pad, FG)
    img_h.save(os.path.join(CAP, f"{icon}_hover.png"))

    # Pressed: stronger fill + bright glyph
    img_p = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img_p)
    bg_pressed = "#cc0000" if icon == "close" else "#1a1a1a"
    rounded_rect(draw, (0, 0, size - 1, size - 1), 4, bg_pressed)
    _draw_caption_glyph(draw, icon, size, pad, FG)
    img_p.save(os.path.join(CAP, f"{icon}_pressed.png"))

def _draw_caption_glyph(draw, icon, size, pad, color):
    if icon == "close":
        draw.line([(pad, pad), (size - pad - 1, size - pad - 1)], fill=color, width=2)
        draw.line([(size - pad - 1, pad), (pad, size - pad - 1)], fill=color, width=2)
    elif icon == "min":
        y = size // 2
        draw.line([(pad, y), (size - pad - 1, y)], fill=color, width=2)

def make_checkbox(size):
    # (box-fill, border, checkmark) per state. The checkmark is drawn bright
    # white inside a dark-filled box for high contrast when selected.
    WHITE = "#ffffff"
    states = {
        "normal": (None, FG_DIM, None),      # empty box, dim border
        "hover": (None, FG, None),           # empty box, bright border
        "checked": (BG_DIM, FG, WHITE),      # dark-filled box, white check
        "disabled": (FG_FAINTER, FG_FAINT, None),
    }
    for name, (bg, border, check) in states.items():
        img = Image.new("RGBA", (size, size), (0,0,0,0))
        draw = ImageDraw.Draw(img)
        rounded_rect(draw, (1, 1, size-2, size-2), 2, bg, border)
        if check is not None:
            pts = [(4, size//2), (size//3, size*2//3), (size-4, size//3)]
            draw.line(pts, fill=check, width=2)
            draw.line([(pts[1][0], pts[1][1]-1), (pts[2][0], pts[2][1]-1)], fill=check, width=2)
        img.save(os.path.join(CHK, f"chk_{name}.png"))

def make_background(w, h, color):
    img = Image.new("RGBA", (w, h), color)
    return img

def draw_rune(draw, x, y, size, color):
    """Draw a stylized rune glyph inspired by the app icon:
    A central vertical stave with an upper X-cross and lower arrow/root.
    """
    cx = x + size // 2
    cy = y + size // 2
    pad = size // 4
    r = pad
    w = max(size // 16, 2)

    # central stave
    draw.line([(cx, y + r), (cx, y + size - r)], fill=color, width=w)
    # upper X: left side
    draw.line([(cx, y + r + (cy - y - r) // 2), (cx - size//3, y + r)], fill=color, width=w)
    draw.line([(cx, y + r + (cy - y - r) // 2), (cx + size//3, y + r)], fill=color, width=w)
    # side verticals
    draw.line([(cx - size//3, y + r), (cx - size//3, cy - r)], fill=color, width=w)
    draw.line([(cx + size//3, y + r), (cx + size//3, cy - r)], fill=color, width=w)
    # lower arrow/roots
    draw.line([(cx, cy + (size - cy - r) // 2), (cx - size//3, y + size - r)], fill=color, width=w)
    draw.line([(cx, cy + (size - cy - r) // 2), (cx + size//3, y + size - r)], fill=color, width=w)
    # top dot
    draw.ellipse([cx - w, y + r - w, cx + w, y + r + w], fill=color)

def main():
    os.makedirs(FORM, exist_ok=True)
    os.makedirs(BTN, exist_ok=True)
    os.makedirs(CHK, exist_ok=True)
    os.makedirs(CAP, exist_ok=True)
    os.makedirs(BK, exist_ok=True)
    os.makedirs(VSCROLL, exist_ok=True)
    os.makedirs(EDIT, exist_ok=True)

    # Backgrounds
    bg_install = make_background(W, H, BG)
    bg_install.save(os.path.join(FORM, "install_bg.png"))

    bg_installing = make_background(W, H, BG)
    bg_installing.save(os.path.join(FORM, "installing_bg.png"))

    bg_finish = make_background(W, H, BG)
    bg_finish.save(os.path.join(FORM, "finish_bg.png"))

    for name in ["uninstall_bg.png", "uninstalling_bg.png", "uninstallfinish_bg.png"]:
        make_background(W, H, BG).save(os.path.join(FORM, name))

    # Logo from app icon
    logo_size = 80
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.abspath(os.path.join(script_dir, "..", "..", ".."))
    icon_path = os.path.join(root_dir, "src-tauri", "icons", "icon.png")
    logo = Image.open(icon_path).resize((logo_size, logo_size), Image.LANCZOS)
    logo.save(os.path.join(FORM, "logo.png"))

    # Banner
    banner = Image.new("RGBA", (480, 250), BG)
    draw = ImageDraw.Draw(banner)
    draw.rectangle([0, 0, 479, 249], outline=FG_FAINT)
    fnt = font(24, True)
    draw.text((30, 30), "galdr", fill=FG, font=fnt)
    fnt2 = font(14)
    draw.text((30, 70), "Media Converter for everyone", fill=FG_DIM, font=fnt2)
    banner.save(os.path.join(FORM, "pic.png"))

    # Progress bar - fore (fill)
    fg_bar = Image.new("RGBA", (448, 6), (0,0,0,0))
    draw = ImageDraw.Draw(fg_bar)
    draw.rectangle([0, 0, 447, 5], fill=FG)
    fg_bar.save(os.path.join(FORM, "fg.png"))

    # Progress bar - back (track)
    bg_bar = Image.new("RGBA", (448, 6), (0,0,0,0))
    draw = ImageDraw.Draw(bg_bar)
    draw.rectangle([0, 0, 447, 5], fill=FG_FAINT)
    bg_bar.save(os.path.join(FORM, "bg.png"))

    # License overlay bg
    lic_bg = Image.new("RGBA", (458, 340), BG)
    draw = ImageDraw.Draw(lic_bg)
    rounded_rect(draw, (0, 0, 457, 339), 4, BG_DIM, FG_FAINT)
    lic_bg.save(os.path.join(FORM, "license_bg.png"))

    # Primary button (140x40) used by the main INSTALL / UNINSTALL actions
    make_button(140, 40, name_prefix="btn")
    import shutil
    shutil.move(os.path.join(BTN, "btn_normal.png"), os.path.join(FORM, "btn_primary_normal.png"))
    shutil.move(os.path.join(BTN, "btn_hover.png"), os.path.join(FORM, "btn_primary_hover.png"))
    shutil.move(os.path.join(BTN, "btn_pressed.png"), os.path.join(FORM, "btn_primary_pressed.png"))

    # Secondary buttons (80x30) used by BROWSE / CANCEL / etc.
    make_button(80, 30, name_prefix="btn")
    shutil.move(os.path.join(BTN, "btn_normal.png"), os.path.join(FORM, "btn_secondary_normal.png"))
    shutil.move(os.path.join(BTN, "btn_hover.png"), os.path.join(FORM, "btn_secondary_hover.png"))
    shutil.move(os.path.join(BTN, "btn_pressed.png"), os.path.join(FORM, "btn_secondary_pressed.png"))

    # Caption buttons
    make_caption_btn(28, icon="close")
    make_caption_btn(28, icon="min")

    # Checkboxes
    make_checkbox(16)

    # Edit box background
    edit_bg = Image.new("RGBA", (200, 28), (0,0,0,0))
    draw = ImageDraw.Draw(edit_bg)
    draw.rectangle([0, 25, 199, 27], fill=FG_FAINT)
    edit_bg.save(os.path.join(EDIT, "edit0.png"))

    # Scrollbar
    scroll = Image.new("RGBA", (8, 8), (0,0,0,0))
    draw = ImageDraw.Draw(scroll)
    draw.rectangle([0, 0, 7, 7], fill=FG_DIM)
    scroll.save(os.path.join(VSCROLL, "vscrollbtn.png"))
    scroll_hot = Image.new("RGBA", (8, 8), (0,0,0,0))
    draw = ImageDraw.Draw(scroll_hot)
    draw.rectangle([0, 0, 7, 7], fill=FG)
    scroll_hot.save(os.path.join(VSCROLL, "vscrollbtn_hot.png"))

    scroll_th = Image.new("RGBA", (8, 30), (0,0,0,0))
    draw = ImageDraw.Draw(scroll_th)
    draw.rectangle([0, 0, 7, 29], fill=FG_FAINT)
    scroll_th.save(os.path.join(VSCROLL, "vscrollbar.png"))
    scroll_th_hot = Image.new("RGBA", (8, 30), (0,0,0,0))
    draw = ImageDraw.Draw(scroll_th_hot)
    draw.rectangle([0, 0, 7, 29], fill=FG)
    scroll_th_hot.save(os.path.join(VSCROLL, "vscrollbar_hot.png"))

    # Background shadow
    bk_shadow = Image.new("RGBA", (W, H), BG)
    bk_shadow.save(os.path.join(BK, "bk_shadow.png"))

    print("All galdr-styled skin assets generated successfully.")

if __name__ == "__main__":
    main()
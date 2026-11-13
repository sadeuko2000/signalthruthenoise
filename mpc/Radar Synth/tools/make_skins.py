#!/usr/bin/env python3
"""Builds skins/ for Radar Synth: the SDK-generated skin plus an XY pad on the MIX tab.

The SDK generator (gen_ui.py) cannot make XY pads, so this script runs it and then adds:
  * xy_bg.png   - the pad background with the four engine names in the corners
  * xy_puck.png - the puck
  * an Image and an XYPad component on the first tab, bound to Mix X (Parameter 1) and Mix Y (Parameter 2).

Usage (after one normal build, which writes build/params.json):
    python tools/make_skins.py --sdk /path/to/mpc-plugin-builder-sdk
Then build again: build.py copies skins/ instead of generating.
Needs Pillow.
"""
import argparse, json, os, shutil, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

PAD = (700, 44, 540, 540)            # x y w h inside the 1280 x 628 tab area (right half; controls sit in the left half)
BG, LINE, INK, LIME = (24, 24, 24, 255), (58, 58, 55, 255), (241, 241, 236, 255), (198, 255, 26, 255)
TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT = "PROPHET", "MS-20", "DX", "WAVE"


def draw_background(path):
    w, h = PAD[2], PAD[3]
    im = Image.new("RGBA", (w, h), BG)
    d = ImageDraw.Draw(im)
    for i in range(1, 8):
        p = round(i * w / 8)
        d.line([(p, 0), (p, h)], fill=LINE, width=1)
        d.line([(0, p), (w, p)], fill=LINE, width=1)
    d.line([(w // 2, 0), (w // 2, h)], fill=(110, 110, 104, 255), width=1)
    d.line([(0, h // 2), (w, h // 2)], fill=(110, 110, 104, 255), width=1)
    d.rectangle([0, 0, w - 1, h - 1], outline=INK, width=2)
    font = ImageFont.load_default(size=30)
    m = 16
    for text, anchor, pos in ((TOP_LEFT, "la", (m, m)), (TOP_RIGHT, "ra", (w - m, m)),
                              (BOTTOM_LEFT, "ld", (m, h - m)), (BOTTOM_RIGHT, "rd", (w - m, h - m))):
        box = d.textbbox(pos, text, font=font, anchor=anchor)
        d.rectangle([box[0] - 6, box[1] - 4, box[2] + 6, box[3] + 4], fill=BG)
        d.text(pos, text, font=font, fill=LIME, anchor=anchor)
    im.save(path)


def draw_puck(path):
    s = 4 * 56
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([8, 8, s - 8, s - 8], fill=(198, 255, 26, 70), outline=LIME, width=20)
    d.ellipse([s // 2 - 16, s // 2 - 16, s // 2 + 16, s // 2 + 16], fill=INK)
    im.resize((56, 56), Image.LANCZOS).save(path)


def entry(name, kind, data, bounds):
    return {"version": 2,
            "componentData": {"version": 1, "name": name, "type": kind, "data": data},
            "handle remapping": {"version": 1, "map": []},
            "bounds": {"version": 1, "acceptsHWFocus": "No", "showWhenDataModelInvalid": "Show", "whenVisible": "Always",
                       "boundsType": "Absolute", "bounds": "%d %d %d %d" % bounds}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sdk", required=True, help="path to a clone of mpc-plugin-builder-sdk")
    args = ap.parse_args()
    project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    params = os.path.join(project, "build", "params.json")
    if not os.path.exists(params):
        sys.exit("build/params.json not found: run the SDK's tools/build.py once first")
    skins = os.path.join(project, "skins")
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "Plugin Skins")
        subprocess.check_call([sys.executable, os.path.join(args.sdk, "tools", "gen_ui.py"), "--params", params,
                               "--ui", os.path.join(project, "ui.json"), "--out", out, "--kit-cache", os.path.join(project, "build")])
        tui_path = os.path.join(out, "TUI.json")
        with open(tui_path) as f:
            tui = json.load(f)
        tab = tui["pageData"]["tabs"][0]
        if tab["tabName"] != "MIX":
            sys.exit("expected the first tab to be MIX")
        comps = tab["componentDefinition"]["componentsData"]
        comps.append(entry("xy background", "Image", {"version": 2, "imageType": "Regular", "colour": "0", "image": "xy_bg.png"}, PAD))
        comps.append(entry("xy pad", "XYPad", {"version": 1, "xPositionHandle": "Parameter 1", "yPositionHandle": "Parameter 2",
                                               "image": "xy_puck.png"}, PAD))
        with open(tui_path, "w") as f:
            json.dump(tui, f, indent=1)
        draw_background(os.path.join(out, "xy_bg.png"))
        draw_puck(os.path.join(out, "xy_puck.png"))
        if os.path.isdir(skins):
            shutil.rmtree(skins)
        shutil.copytree(out, skins)
    print("skins/ written with the XY pad on the MIX tab")


if __name__ == "__main__":
    main()

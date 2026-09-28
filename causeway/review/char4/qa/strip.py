"""strip.py out.png x0 y0 w h in1.png in2.png … — crop each frame (top-left origin) and lay them in a row."""
import sys
import bpy
import numpy as np
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
out, x0, y0, w, h, ins = args[0], *map(int, args[1:5]), args[5:]
tiles = []
for p in ins:
    im = bpy.data.images.load(p)
    a = np.array(im.pixels[:], np.float32).reshape(im.size[1], im.size[0], 4)[::-1]
    tiles.append(a[y0:y0 + h, x0:x0 + w])
sheet = np.concatenate(tiles, axis=1)[::-1]
o = bpy.data.images.new("s", sheet.shape[1], sheet.shape[0], alpha=True)
o.pixels[:] = sheet.ravel()
o.filepath_raw = out
o.file_format = "PNG"
o.save()

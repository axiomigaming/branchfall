"""montage.py out.png in1.png in2.png … — side-by-side contact sheet (rows of 3)."""
import sys
import bpy
import numpy as np
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
out, ins = args[0], args[1:]
ims = []
for p in ins:
    im = bpy.data.images.load(p)
    ims.append(np.array(im.pixels[:], np.float32).reshape(im.size[1], im.size[0], 4))
h = max(i.shape[0] for i in ims); w = max(i.shape[1] for i in ims)
cols = min(3, len(ims)); rows = (len(ims) + cols - 1) // cols
sheet = np.ones((rows * h, cols * w, 4), np.float32)
for k, a in enumerate(ims):
    r, c = divmod(k, cols)
    r = rows - 1 - r
    sheet[r * h:r * h + a.shape[0], c * w:c * w + a.shape[1]] = a
o = bpy.data.images.new("m", cols * w, rows * h, alpha=True)
o.pixels[:] = sheet.ravel()
o.filepath_raw = out; o.file_format = "PNG"; o.save()

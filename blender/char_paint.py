"""Repaint the supplied runner's texture atlas into an original adventurer (see build_runner.py).

The atlas is one 1024² sheet of many charts. Every texel's place on the body comes from a bake of the
surface position into UV space, so edits are written as rules over (where on the body, what colour):

  * the shoulder-holster harness (straps, back cross, the pouch under the right arm) is painted out:
    a push-pull fill from the surrounding shirt in colour, and toward flat in the normal map;
  * the shirt is shifted to a warmer, sun-bleached sand; the trousers to a dark field olive; the
    T-shirt under the open collar to a slate blue-grey.
The satchel, its strap and the neckerchief are modelled on top (char_kit.py).
"""
import math
import os

import bpy
import numpy as np

from common import nodes_clear, N, L

SIZE = 1024


def _img_array(im):
    w, h = im.size
    a = np.array(im.pixels[:], np.float32).reshape(h, w, 4)
    return a


def bake_position(ob, size=SIZE):
    """Surface position (object space) per texel, and the coverage mask."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 1
    mat = bpy.data.materials.new("posbake")
    nt = nodes_clear(mat)
    out = N(nt, "ShaderNodeOutputMaterial")
    em = N(nt, "ShaderNodeEmission")
    geo = N(nt, "ShaderNodeNewGeometry")
    L(nt, geo.outputs["Position"], em.inputs["Color"])
    L(nt, em.outputs[0], out.inputs[0])
    img = bpy.data.images.new("posbake", size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    img.generated_color = (0, 0, 0, 0)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex
    old = list(ob.data.materials)
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type="EMIT", margin=0, use_clear=True)
    a = _img_array(img)
    ob.data.materials.clear()
    for m in old:
        ob.data.materials.append(m)
    bpy.data.images.remove(img)
    bpy.data.materials.remove(mat)
    return a[:, :, :3], a[:, :, 3] > 0.5


def rgb_to_hsv(c):
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    mx = np.max(c[..., :3], -1)
    mn = np.min(c[..., :3], -1)
    d = mx - mn + 1e-6
    h = np.where(mx == r, (g - b) / d % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    s = np.where(mx > 1e-6, (mx - mn) / (mx + 1e-6), 0)
    return h, s, mx


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _down(a, w):
    h2, w2 = a.shape[0] // 2, a.shape[1] // 2
    aw = (a * w[..., None]).reshape(h2, 2, w2, 2, -1).sum((1, 3))
    ww = w.reshape(h2, 2, w2, 2).sum((1, 3))
    return aw / np.maximum(ww, 1e-6)[..., None], np.minimum(ww, 1.0)


def push_pull(a, known):
    """Fill the unknown texels from the known ones (pyramid push-pull)."""
    levels = [(a, known.astype(np.float32))]
    while levels[-1][0].shape[0] > 4:
        levels.append(_down(*levels[-1]))
    fill = levels[-1][0]
    for a_, w_ in reversed(levels[:-1]):
        up = np.repeat(np.repeat(fill, 2, 0), 2, 1)
        # A little blur so the coarse levels don't print blocks.
        up = 0.5 * up + 0.125 * (np.roll(up, 1, 0) + np.roll(up, -1, 0) + np.roll(up, 1, 1) + np.roll(up, -1, 1))
        fill = a_ * w_[..., None] + up * (1 - w_[..., None])
    return fill


def blur(m, r=2):
    for _ in range(r):
        m = 0.2 * (m + np.roll(m, 1, 0) + np.roll(m, -1, 0) + np.roll(m, 1, 1) + np.roll(m, -1, 1))
    return m


def dilate(m, r):
    for _ in range(r):
        m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    return m


def masks(P, cov, alb, H=1.81):
    """Soft region masks over the atlas from the A-pose position bake and the colour."""
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    ax = np.abs(x)
    h, s, v = rgb_to_hsv(alb)
    # Leather: redder (hue < ~28°) and more saturated (> ~0.45) than the shirt, whose folds keep its hue.
    leather = smoothstep(34, 29, h) * smoothstep(0.42, 0.5, s) * smoothstep(0.78, 0.62, v)
    brown = smoothstep(31, 26, h) * smoothstep(0.33, 0.43, s)
    torso = cov & (z > 1.02) & (z < 1.56) & ((ax < 0.235) | ((ax < 0.275) & (z < 1.38)))
    harness = leather * torso
    # Not the skin in the open collar or the back of the neck.
    harness *= ~((z > 1.36) & (ax < 0.08) & (y > 0.0)) & ~((z > 1.49) & (ax < 0.075))
    # Skin: rosier, more saturated than the shirt; the forearms, hands, neck and head.
    skinlike = smoothstep(14, 22, h) * smoothstep(34, 26, h) * smoothstep(0.3, 0.38, s) * smoothstep(0.45, 0.6, v)
    shirtlike = smoothstep(18, 26, h) * smoothstep(60, 48, h) * smoothstep(0.42, 0.32, s) * smoothstep(0.3, 0.45, v)
    arm_upper = cov & (ax > 0.17) & (z > 1.05) & (z < 1.5)
    shirt_zone = cov & (((z > 1.0) & (z < 1.52) & (ax < 0.23)) | arm_upper)
    shirt = shirtlike * (1 - 0.7 * skinlike) * shirt_zone
    trouser_zone = cov & (z > 0.14) & (z < 1.0) & (ax < 0.3)
    shirtcol = smoothstep(44, 38, h) * smoothstep(0.24, 0.3, s)
    trousers = trouser_zone * (1 - brown) * (1 - shirtcol)
    tee = cov & (z > 1.32) & (z < 1.55) & (ax < 0.09) & (y > 0.0)
    tee = tee * smoothstep(0.2, 0.1, s) * smoothstep(0.25, 0.35, v)
    holster = cov & (x > 0.17) & (x < 0.3) & (z > 0.7) & (z < 0.945)
    holster = holster * smoothstep(36, 31, h) * smoothstep(0.3, 0.4, s)
    brownish = smoothstep(36, 32, h) * smoothstep(0.38, 0.44, s) * torso
    return dict(holster=holster, brownish=brownish, harness=harness, shirt=shirt, trousers=trousers, tee=tee, leather=leather, cov=cov)


def recolour(rgb, w, mean_from, mean_to, keep=0.0):
    """Move the masked texels' colour so their mean goes from `mean_from` to `mean_to` (per-channel gain in
    linear light, so the folds and the weave keep their contrast)."""
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    f = lambda c: np.where(np.array(c) <= 0.04045, np.array(c) / 12.92, ((np.array(c) + 0.055) / 1.055) ** 2.4)
    gain = f(mean_to) / np.maximum(f(mean_from), 1e-4)
    out = lin * (1 + (gain - 1) * w[..., None])
    return np.where(out <= 0.0031308, out * 12.92, 1.055 * np.clip(out, 0, None) ** (1 / 2.4) - 0.055)


def mean_of(rgb, w):
    ws = w.sum()
    return (rgb * w[..., None]).reshape(-1, 3).sum(0) / max(ws, 1e-6)


def repaint(ob, src_dir, out_dir, debug=None):
    """Write the edited albedo / normal / ORM maps; returns their paths."""
    P, cov = bake_position(ob)
    alb_im = bpy.data.images.load(os.path.join(src_dir, "albedo.png"))
    nrm_im = bpy.data.images.load(os.path.join(src_dir, "normal.png"))
    nrm_im.colorspace_settings.name = "Non-Color"
    rgh_im = bpy.data.images.load(os.path.join(src_dir, "roughness.png"))
    rgh_im.colorspace_settings.name = "Non-Color"
    met_im = bpy.data.images.load(os.path.join(src_dir, "metallic.png"))
    met_im.colorspace_settings.name = "Non-Color"
    alb = _img_array(alb_im)[..., :3]
    nrm = _img_array(nrm_im)[..., :3]
    rgh = _img_array(rgh_im)[..., 0]
    met = _img_array(met_im)[..., 0]
    M = masks(P, cov, alb)
    core = M["harness"] > 0.3
    # The strap's shaded edges are only half as saturated: take any brownish texel near a strap too.
    hole = (dilate(core, 4) | (dilate(core, 12) & (M["brownish"] > 0.5))) & cov
    # The thigh holster on the left hip goes the same way, filled from the trousers.
    hol = dilate(M["holster"] > 0.4, 3) & cov & ~hole
    hole_soft = np.zeros_like(rgh)
    flat = np.array([0.5, 0.5, 1.0], np.float32)
    for hl, src in ((hole, M["shirt"]), (hol, M["trousers"])):
        soft = np.clip(blur(hl.astype(np.float32), 2) * 1.6, 0, 1) * cov
        # Fill only from the cloth itself (a pouch's whole chart would otherwise fill from its atlas
        # neighbours): colour, normal and roughness.
        known = cov & ~dilate(hole | hol, 2) & (src > 0.4)
        fill = push_pull(np.concatenate([alb, nrm, rgh[..., None]], -1), known)
        k = soft[..., None]
        alb = alb * (1 - k) + fill[..., :3] * k
        nrm = nrm * (1 - k) + (0.85 * flat + 0.15 * fill[..., 3:6]) * k
        rgh = rgh * (1 - soft) + fill[..., 6] * soft
        met = met * (1 - soft)
        hole_soft = np.maximum(hole_soft, soft)
    shirt_hole = np.clip(blur(hole.astype(np.float32), 2) * 1.6, 0, 1) * cov
    trouser_hole = np.clip(blur(hol.astype(np.float32), 2) * 1.6, 0, 1) * cov
    # Recolour (measured from the source, toward the new palette).
    shirt_w = np.maximum(M["shirt"], shirt_hole)
    s0 = mean_of(alb, M["shirt"])
    alb = recolour(alb, np.clip(shirt_w, 0, 1), s0, (0.74, 0.63, 0.43))
    t0 = mean_of(alb, M["trousers"])
    alb = recolour(alb, np.maximum(M["trousers"], trouser_hole), t0, (0.215, 0.23, 0.15))
    e0 = mean_of(alb, M["tee"])
    alb = recolour(alb, M["tee"], e0, (0.42, 0.48, 0.54))
    print("  repaint: shirt %s → sand, trousers %s → olive, tee %s → slate; harness texels %d" % (
        np.round(s0, 3), np.round(t0, 3), np.round(e0, 3), int(hole.sum())), flush=True)
    # Pad the charts again (bilinear and mip filtering read past their edges).
    padded = push_pull(np.concatenate([alb, nrm, rgh[..., None], met[..., None]], -1), cov)
    c = cov[..., None]
    alb = np.where(c, alb, padded[..., :3])
    nrm = np.where(c, nrm, padded[..., 3:6])
    rgh = np.where(cov, rgh, padded[..., 6])
    met = np.where(cov, met, padded[..., 7])
    os.makedirs(out_dir, exist_ok=True)
    np.save(os.path.join(out_dir, "harness_mask.npy"), hole_soft)
    if debug:
        dbg = np.concatenate([np.stack([M["harness"], M["shirt"], M["trousers"]], -1), np.ones_like(rgh)[..., None]], -1)
        _save(debug, dbg, "Non-Color")
    paths = {"mask": os.path.join(out_dir, "harness_mask.npy")}
    one = np.ones_like(rgh)
    paths["color"] = _save(os.path.join(out_dir, "runner_color.png"), np.concatenate([alb, one[..., None]], -1), "sRGB")
    paths["normal"] = _save(os.path.join(out_dir, "runner_normal.png"), np.concatenate([nrm, one[..., None]], -1), "Non-Color")
    paths["orm"] = _save(os.path.join(out_dir, "runner_orm.png"), np.stack([one, rgh, met, one], -1), "Non-Color")
    for im in (alb_im, nrm_im, rgh_im, met_im):
        bpy.data.images.remove(im)
    return paths


def _save(path, arr, cs):
    h, w = arr.shape[:2]
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    im.colorspace_settings.name = cs
    im.pixels[:] = np.clip(arr, 0, 1).astype(np.float32).ravel()
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)
    return path


def flatten_harness(ob, mask_path, iters=40):
    """The harness is modelled in relief (straps, the back cross, two pouches under the arms): relax
    those vertices into the shirt around them (Laplacian smoothing that only moves the strap vertices)."""
    import bmesh
    M = np.load(mask_path)
    h, w = M.shape
    me = ob.data
    uv = me.uv_layers.active.data
    acc = np.zeros(len(me.vertices))
    cnt = np.zeros(len(me.vertices))
    for lp in me.loops:
        u, v = uv[lp.index].uv
        i = min(h - 1, max(0, int(v * h)))
        j = min(w - 1, max(0, int(u * w)))
        acc[lp.vertex_index] += M[i, j]
        cnt[lp.vertex_index] += 1
    k = acc / np.maximum(cnt, 1)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    sel = [v for v in bm.verts if k[v.index] > 0.35]
    # One ring of neighbours eases the step at the strap's edge.
    ring = {e.other_vert(v) for v in sel for e in v.link_edges} - set(sel)
    wts = {v: 1.0 for v in sel}
    wts.update({v: 0.35 for v in ring})
    for _ in range(iters):
        new = {}
        for v, a in wts.items():
            nb = [e.other_vert(v).co for e in v.link_edges]
            if not nb:
                continue
            c = sum(nb, v.co * 0) / len(nb)
            new[v] = v.co.lerp(c, 0.5 * a)
        for v, c in new.items():
            v.co = c
    bm.to_mesh(me)
    bm.free()
    me.update()
    print(f"  harness relief relaxed: {len(sel)} + {len(ring)} verts", flush=True)

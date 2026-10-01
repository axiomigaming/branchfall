"""The runner → public/assets/runner.glb.

The body is the owner-supplied character (blender/sources/runner, see PROVENANCE.md) exactly as
supplied — his face and hair, the cream henley with rolled sleeves, blue-grey jeans, the brown leather
cross-harness and holster, the boots — rigged here, locally, onto the CAUSEWAY skeleton (never uploaded
to an auto-rigging or animation service) and driven by all of our clips.

Pipeline:
  1. Source (char_source.py): import, Z-up / +Y forward, scaled to the game's 1.81 m stature, welded,
     smooth-shaded (sharp only at real creases), area-weighted custom normals.
  2. Maps (char_paint.py): the supplied albedo and normal untouched; roughness + metallic packed to ORM.
  3. Rig (char_rig.py): joints measured from cross-sections; bone heat on a closed voxel proxy, repaired
     at the crotch, flanks, boots and hands; A-pose → our rest pose (arms down, feet under the hips)
     baked and applied, so the clips read as authored.
  4. Animate (runner_anim.py: every clip regenerated on this rig; the contact solver and gait IK take
     their leg lengths and soles from it) and export (PNG maps: tools/optimize-assets.mjs encodes once).

    python3 blender/build_runner.py [--preview[=model|run|react|react2|all]] [--reuse]
    python3 blender/build_runner.py --procedural …   (the round-1…4 sculpted character, build_runner_procedural.py)

`--reuse` skips 1–3 and loads the last built model from blender/cache (for animation work).
"""
import os
import runpy
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

if "--procedural" in sys.argv:
    runpy.run_path(os.path.join(HERE, "build_runner_procedural.py"), run_name="__main__")
    sys.exit(0)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from common import reset, export_glb, textured_material, OUT, CACHE  # noqa: E402
import char_sculpt as S  # noqa: E402
import char_source as CS  # noqa: E402
import char_paint as CP  # noqa: E402
import char_rig as R  # noqa: E402

PREVIEW = next((a.split("=", 1)[1] if "=" in a else "all" for a in sys.argv if a.startswith("--preview")), None)
REUSE = "--reuse" in sys.argv
MODEL_BLEND = os.path.join(CACHE, "runner_src_model.blend")
TEXDIR = os.path.join(CACHE, "runner_src")
FPS = 30


def build_model():
    reset()
    bpy.context.scene.render.fps = FPS
    os.makedirs(TEXDIR, exist_ok=True)
    body = CS.load()
    CS.weld_and_smooth(body)
    CS.relax_crown(body)
    tex = CP.source_maps(CS.SRC, TEXDIR)
    J = CS.landmarks(body)
    rig = R.build_rig(J)
    rig["sole"] = [J["heel.L"].y - J["ankle.L"].y, J["toe.L"].y - J["ankle.L"].y, J["tip.L"].y - J["ankle.L"].y, J["ankle.L"].z]
    R.heat_skin(rig, body)
    R.repair(body, J)
    R.bind(body, rig)
    R.repose(rig, body, J)
    # The sole as it now stands: the ankle's height above the lowest point of the boot (left).
    ank = rig.data.bones["foot.L"].head_local
    zmin = min(v.co.z for v in body.data.vertices if v.co.x > 0.03 and v.co.z < 0.05)
    s_ = list(rig["sole"])
    s_[3] = ank.z - zmin
    rig["sole"] = s_
    R.set_rolls(rig)
    for m in list(body.modifiers):
        body.modifiers.remove(m)
    CS.weighted_normals(body)
    imgs = []
    for k in ("color", "normal", "orm"):
        im = bpy.data.images.load(tex[k])
        im.name = f"runner_{k}"
        if k != "color":
            im.colorspace_settings.name = "Non-Color"
        imgs.append(im)
    mat = textured_material("runner", *imgs)
    body.data.materials.clear()
    body.data.materials.append(mat)
    mesh = body
    mesh.name = mesh.data.name = "runner_mesh"
    R.finish(mesh, rig)
    R.bind(mesh, rig)
    print("runner tris:", S.tri_count(mesh), flush=True)
    return rig, mesh


if REUSE and os.path.exists(MODEL_BLEND):
    bpy.ops.wm.open_mainfile(filepath=MODEL_BLEND)
    rig = bpy.data.objects["runner"]
    mesh = bpy.data.objects["runner_mesh"]
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    for o in list(bpy.data.objects):
        if o not in (rig, mesh):
            bpy.data.objects.remove(o)
else:
    rig, mesh = build_model()
    if not PREVIEW or "--save" in sys.argv:
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=MODEL_BLEND, compress=True)

import runner_anim  # noqa: E402

bpy.context.scene.render.fps = FPS
runner_anim.build(rig)
if PREVIEW:
    runner_anim.previews(rig, PREVIEW)
    sys.exit(0)
export_glb(os.path.join(OUT, "runner.glb"), [rig, mesh], anim=True, webp=False)
os._exit(0)  # bpy can crash on interpreter teardown after an export

"""The runner → public/assets/runner.glb.

The body is the owner-supplied mesh (blender/sources/runner, see PROVENANCE.md), rigged here, locally,
onto the CAUSEWAY skeleton — never uploaded to an auto-rigging or animation service — and dressed as our
own adventurer: the source's shoulder-holster harness and thigh holster are painted and relaxed out, the
shirt is a warmer sun-bleached sand, the trousers a dark field olive, the T-shirt under the open collar a
slate blue-grey, and he wears our kit — a compact leather satchel on the back of the left hip on a
cross-body strap, and a rust neckerchief knotted at the nape whose tails stream in the wind of the run.

Pipeline:
  1. Source (char_source.py): import, Z-up / +Y forward, scaled to the game's 1.81 m stature, welded,
     smooth-shaded (sharp only at real creases), area-weighted custom normals.
  2. Repaint (char_paint.py): a position bake drives region masks over the 1024² atlas; harness out
     (colour fill from the shirt, normal map flattened, relief relaxed), recolour shirt / trousers / tee.
  3. Rig (char_rig.py): joints measured from cross-sections; bone heat on a closed voxel proxy, repaired
     at the crotch, flanks, boots and hands; A-pose → our rest pose (arms down, feet under the hips)
     baked and applied, so the clips read as authored.
  4. Kit (char_kit.py): satchel, strap and neckerchief on the rest body, spring bones (pack, scarf.*),
     baked to a 512² kit atlas.
  5. Animate (runner_anim.py: every clip regenerated on this rig; the contact solver and gait IK take
     their leg lengths and soles from it) and export.

    python3 blender/build_runner.py [--preview[=model|run|react|react2|all]] [--reuse]
    python3 blender/build_runner.py --procedural …   (the round-1…4 sculpted character, build_runner_procedural.py)

`--reuse` skips 1–4 and loads the last built model from blender/cache (for animation work).
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
import char_kit as K  # noqa: E402

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
    tex = CP.repaint(body, CS.SRC, TEXDIR)
    CP.flatten_harness(body, tex["mask"])
    J = CS.landmarks(body)
    rig = R.build_rig(J)
    rig["sole"] = [J["heel.L"].y - J["ankle.L"].y, J["toe.L"].y - J["ankle.L"].y, J["tip.L"].y - J["ankle.L"].y, J["ankle.L"].z]
    R.heat_skin(rig, body)
    R.repair(body, J)
    R.bind(body, rig)
    R.repose(rig, body, J)
    # The kit is fitted to the rest body.
    B = rig.data.bones
    J2 = {"neck": B["neck"].head_local.copy(), "head": B["head"].head_local.copy(), "pelvis": B["hips"].head_local.copy(),
          "hip.L": B["thigh.L"].head_local.copy(), "shoulder.R": B["upper_arm.R"].head_local.copy()}
    kit, pack, scarf_pts = K.build_kit(body, J2)
    R.add_spring_bones(rig, pack[0], pack[1], scarf_pts)
    K.bake_kit(kit, TEXDIR)
    for m in list(body.modifiers):
        body.modifiers.remove(m)
    CS.weighted_normals(body)
    imgs = [bpy.data.images.load(tex[k]) for k in ("color", "normal", "orm")]
    for im in imgs[1:]:
        im.colorspace_settings.name = "Non-Color"
    mat = textured_material("runner", *imgs)
    body.data.materials.clear()
    body.data.materials.append(mat)
    mesh = S.join([body, kit], "runner_mesh")
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
export_glb(os.path.join(OUT, "runner.glb"), [rig, mesh], anim=True, quality=86)
os._exit(0)  # bpy can crash on interpreter teardown after an export

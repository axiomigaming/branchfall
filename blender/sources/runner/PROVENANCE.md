# Runner source

`runner.obj` (5,882 vertices, UV-mapped, no normals, rig or animation) and its
four PBR maps (`albedo`, `normal`, `roughness`, `metallic`) were supplied by the
project owner (generated with a 3D service they use) and imported from the
owner's `axiomigaming/pursuit` repository (`lab/ui/public/assets/runner/`).

They are a source input only: `blender/build_runner.py` rigs the mesh onto the
CAUSEWAY skeleton locally in Blender and exports `public/assets/runner.glb`.
Per the owner's instruction carried over from that repository, the character is
not uploaded to Mixamo or any other external rigging, conversion or animation
service.

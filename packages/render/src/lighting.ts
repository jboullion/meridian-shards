// The original D3D client's lighting, as GLSL.
//
// Brightness (clientd3d/draw3d.c GetLightPaletteIndex, evaluated at distance FINENESS
// because the D3D path uses hardware fog for distance; d3drender.c *Extract):
//   sector light > 127 ("ambient" sectors):
//     row light  = min(255, 8 * viewerLight + ambient)            (LIGHT_INDEX at 2048 units)
//     index      = trunc((rowLight + light - 192) * 64 / 256)
//     index      = (lightScale * index) >> 10                    (sun shading, if any)
//   sector light <= 127 (no ambient):
//     index      = trunc(min(255, 16 * viewerLight) * 64 / 256) + light / 2
//   index clamped to 0..63; vertex grey = index * 239 / 64        (COLOR_AMBIENT = 239)
// Sun shading (walls and sloped planes; draw3d.c SetLightingInfo):
//   lightScale = ((n . sun) >> 10 + 1024) >> 1, then (1024 - shade) + lightScale * shade >> 10
// Fog (d3drender.c D3DRenderFogEndCalc): linear to black from 0 to
//   no ambient:  16384 + light * 1024 + viewerLight * 64
//   ambient:     32768 + max(0, light - 192) * 1024 + viewerLight * 64 + ambient * 1024
// in client fine units of view depth.
//
// Pixels: 8-bit palette indices (R8 texture) looked up in the 256-entry palette;
// index 254 is transparent. With smooth textures (the original's filtering:
// colorTexture.ts), an RGBA copy is sampled instead, transparent where alpha is low.
//
// Ours, Enhanced lighting (off, everything is as above):
//   - soft highlights: a colour that would clip rolls off towards white instead, keeping
//     its hue (scaled by its largest channel), so lit stone keeps its texture and the
//     light's colour; nothing changes below SOFT_KNEE, nor anything a light doesn't add to;
//   - lights stop at walls: a per-surface mask (lightOcclusion.ts) says which lights see it;
//   - shaded corners: the sector light is darkened where floors and ceilings meet walls
//     (roomAo.ts), and along walls near their floor and ceiling.
// The glow pass (postFx.ts) draws the room black, to hide what's behind it.

/** Shared by every room and sprite material: 1 while postFx.ts draws the glow pass */
export const glowPass = { value: 0 };

export const lightingUniforms = () => ({
  uPalette: { value: null as unknown },
  uMap: { value: null as unknown },
  /** The RGBA copy of uMap (colorTexture.ts), sampled when uColorMode is 1 */
  uColorMap: { value: null as unknown },
  uColorMode: { value: 0 },
  /** Ours: Enhanced lighting's soft highlights (1) or the original's clamp (0) */
  uSoftLight: { value: 0 },
  /** Player light (BP_PLAYER / BP_LIGHT_PLAYER), 0..255 */
  uViewerLight: { value: 0 },
  /** Room ambient light (BP_PLAYER / BP_LIGHT_AMBIENT), 0..255 */
  uAmbient: { value: 0 },
  /** Sun direction (client x/y, unit) and shade amount (0..1024) from BP_LIGHT_SHADING */
  uSun: { value: [1, 0] as [number, number] },
  uShade: { value: 0 },
  uFog: { value: 1 },
  /** client fine units per world unit (the scene uses 1 unit = 1 grid square) */
  uFinePerUnit: { value: 1024 },
  /** texture scroll offset (s, t) for scrolling walls/floors */
  uScroll: { value: [0, 0] as [number, number] },
  /**
   * Light sources (light maps): xyz in client fine units, w = reach (DLIGHT_SCALE / 2),
   * negative for a highlight light (no falloff on floors)
   */
  uLightPos: { value: new Float32Array(32 * 4) },
  /** Light colours 0..1 */
  uLightColor: { value: new Float32Array(32 * 3) },
  uLightCount: { value: 0 },
  uGlowPass: glowPass,
  /** Shaded corners: on (1), the corner map (roomAo.ts) and where it lies (x0, y0, 1/width, 1/height in fine units) */
  uAo: { value: 0 },
  uAoMap: { value: null as unknown },
  uAoRect: { value: [0, 0, 1, 1] as [number, number, number, number] },
});

export const roomVertexShader = /* glsl */ `
in float aLight;
in vec3 aShade;
in float aMask0;
in float aMask1;
// Ours: x = 0 wall, 1 floor, 2 ceiling; y, z = the floor and ceiling heights in front (roomAo.ts surfaceInfo)
in vec3 aSurface;
out vec3 vSurface;
out vec2 vUv;
flat out int vMask0;
flat out int vMask1;
out float vLight;
out float vScale;
out float vDepth;
out vec3 vClient;
out vec2 vNormal2;
uniform vec2 uSun;
uniform float uShade;
uniform float uFinePerUnit;
uniform vec2 uScroll;

void main() {
  vUv = uv + uScroll;
  vLight = aLight;
  float scale = 1024.0;
  if (aShade.z > 0.5 && uShade > 0.0) {
    float ls = floor(dot(aShade.xy * 1024.0, uSun * 1024.0) / 1024.0);
    ls = floor((ls + 1024.0) / 2.0);
    ls = (1024.0 - uShade) + floor(ls * uShade / 1024.0);
    scale = clamp(ls, 0.0, 1024.0);
  }
  vScale = scale;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z * uFinePerUnit;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vClient = vec3(world.x, world.z, world.y) * uFinePerUnit; // scene (x, z up, y) -> client (x, y, z)
  vNormal2 = aShade.xy;
  vMask0 = int(aMask0);
  vMask1 = int(aMask1);
  vSurface = aSurface;
  gl_Position = projectionMatrix * mv;
}
`;

export const roomFragmentShader = /* glsl */ `
precision highp float;
in vec2 vUv;
in float vLight;
in float vScale;
in float vDepth;
in vec3 vClient;
in vec2 vNormal2;
flat in int vMask0;
flat in int vMask1;
in vec3 vSurface;
out vec4 fragColor;
uniform float uGlowPass;
uniform float uAo;
uniform sampler2D uAoMap;
uniform vec4 uAoRect;
uniform vec4 uLightPos[32];
uniform vec3 uLightColor[32];
uniform int uLightCount;
uniform sampler2D uMap;
uniform sampler2D uColorMap;
uniform float uColorMode;
uniform float uSoftLight;
uniform sampler2D uPalette;
uniform float uViewerLight;
uniform float uAmbient;
uniform float uFog;

float lightIndex(float light, float scale) {
  float idx;
  if (light > 127.0) {
    float row = min(255.0, floor(8.0 * uViewerLight) + uAmbient);
    idx = trunc((row + light - 192.0) * 64.0 / 256.0);
    if (scale != 1024.0) idx = floor(scale * idx / 1024.0);
  } else {
    idx = floor(min(255.0, 16.0 * uViewerLight) * 64.0 / 256.0) + floor(light / 2.0);
  }
  return clamp(idx, 0.0, 63.0);
}

// Shaded corners: how much of the sector light reaches here (1 = all)
const float AO_STRENGTH = 0.5;
const float AO_WALL_REACH = 320.0;
float cornerLight() {
  if (vSurface.x > 0.5) {
    vec2 m = texture(uAoMap, (vClient.xy - uAoRect.xy) * uAoRect.zw).rg;
    return 1.0 - AO_STRENGTH * (vSurface.x > 1.5 ? m.g : m.r);
  }
  // Walls: darker towards the floor and ceiling in front of them
  float nearFloor = 1.0 - smoothstep(0.0, AO_WALL_REACH, vClient.z - vSurface.y);
  float nearCeiling = 1.0 - smoothstep(0.0, AO_WALL_REACH, vSurface.z - vClient.z);
  return 1.0 - AO_STRENGTH * 0.8 * max(nearFloor * nearFloor, nearCeiling * nearCeiling);
}

// Soft highlights: past the knee (SOFT_KNEE, or the unlit colour's brightest channel if
// that's more), the colour's brightest channel rolls off towards 1 and the others follow
const float SOFT_KNEE = 0.8;
vec3 softHighlight(vec3 base, vec3 c) {
  float m = max(c.r, max(c.g, c.b));
  float knee = max(SOFT_KNEE, max(base.r, max(base.g, base.b)));
  if (m <= knee) return c;
  float room = max(1.0 - knee, 1e-3);
  return c * ((knee + room * (1.0 - exp(-(m - knee) / room))) / m);
}

void main() {
  vec3 rgb;
  if (uColorMode > 0.5) {
    vec4 c = texture(uColorMap, vUv);
    if (c.a < 0.5) discard;
    rgb = c.rgb;
  } else {
    float index = floor(texture(uMap, vUv).r * 255.0 + 0.5);
    if (index == 254.0) discard;
    rgb = texelFetch(uPalette, ivec2(int(index), 0), 0).rgb;
  }
  if (uGlowPass > 0.5) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float light = floor(vLight + 0.5);
  float grey = floor(lightIndex(light, vScale) * 239.0 / 64.0) / 255.0;
  if (uAo > 0.5) grey *= cornerLight();
  float fogEnd = light <= 127.0
    ? 16384.0 + light * 1024.0 + uViewerLight * 64.0
    : 32768.0 + max(0.0, light - 192.0) * 1024.0 + uViewerLight * 64.0 + uAmbient * 1024.0;
  float fog = uFog > 0.5 ? clamp((fogEnd - vDepth) / fogEnd, 0.0, 1.0) : 1.0;
  // Light maps (d3dlighting.c D3DRenderLMapPost*Add): each light adds
  // radial(in-plane distance) * falloff(distance off the plane) * colour * texel.
  vec3 added = vec3(0.0);
  bool wall = length(vNormal2) > 0.5;
  bool xMajor = abs(vNormal2.x) > abs(vNormal2.y);
  for (int i = 0; i < 32; i++) {
    if (i >= uLightCount) break;
    // Lights that can't see this surface (lightOcclusion.ts; all bits set without it)
    int mask = i < 16 ? vMask0 : vMask1;
    if (((mask >> (i & 15)) & 1) == 0) continue;
    vec3 d = vClient - uLightPos[i].xyz;
    float reach = abs(uLightPos[i].w);
    bool highlight = uLightPos[i].w < 0.0;
    float off, radial;
    if (!wall) { off = abs(d.z); radial = length(d.xy); }
    else if (xMajor) { off = abs(d.x); radial = length(d.yz); }
    else { off = abs(d.y); radial = length(d.xz); }
    // D3DRenderLMapPostFloorAdd: a highlight light (on the floor) has no falloff on floors, not ceilings
    float falloff = highlight && !wall && d.z < 64.0 ? 1.0 : max(0.0, 1.0 - off / reach);
    float k = max(0.0, 1.0 - radial / reach) * falloff;
    added += k * uLightColor[i];
  }
  if (uSoftLight > 0.5) {
    fragColor = vec4(softHighlight(rgb * grey, rgb * grey + rgb * added) * fog, 1.0);
  } else {
    fragColor = vec4(min(vec3(1.0), rgb * grey + rgb * added) * fog, 1.0);
  }
}
`;

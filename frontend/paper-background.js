import {
  ShaderMount,
  getShaderNoiseTexture,
  paperTextureFragmentShader,
} from '@paper-design/shaders';

const MAX_PIXEL_COUNT = 1_500_000;

const FALLBACK_BACKGROUND_COLOR = '#e5e5e2';
const FALLBACK_BACKGROUND_IMAGE = [
  'radial-gradient(circle at 18% 12%, rgb(255 255 255 / 0.54), transparent 46%)',
  'repeating-linear-gradient(103deg, rgb(84 89 96 / 0.025) 0 1px, transparent 1px 5px)',
  'repeating-linear-gradient(8deg, rgb(255 255 255 / 0.24) 0 2px, transparent 2px 10px)',
].join(', ');

const PAPER_UNIFORMS = {
  // Keep a stable aspect ratio even though this is a standalone texture.
  u_imageAspectRatio: 1,
  u_isImage: false,
  u_colorBack: [0.855, 0.86, 0.858, 1],
  u_colorPaper: [0.9, 0.902, 0.895, 1],
  u_colorShadow: [0.3, 0.32, 0.35, 0.22],
  u_blending: 0,
  u_distortion: 0,
  u_clip: false,
  u_angle: 118,
  u_seed: 37,
  u_roughness: 0.34,
  u_roughnessSize: 0.66,
  u_roughnessRows: 0.14,
  u_fiber: 0.27,
  u_fiberSize: 0.58,
  u_folds: 0.045,
  u_foldSizeX: 0.7,
  u_foldSizeY: 0.66,
  u_foldOffsetX: 0.34,
  u_foldOffsetY: 0.58,
  u_wrinkles: 0.025,
  u_wrinkleSize: 0.62,
  u_crumples: 0,
  u_crumpleCount: 2,
  u_drops: 0.08,
  // PaperTexture uses this tiny bundled image for deterministic noise.
  u_noiseTexture: undefined,
  // Shader sizing uniforms. A full-viewport, non-image texture needs no fit.
  u_fit: 0,
  u_scale: 1,
  u_rotation: 0,
  u_originX: 0.5,
  u_originY: 0.5,
  u_offsetX: 0,
  u_offsetY: 0,
  u_worldWidth: 0,
  u_worldHeight: 0,
};

function noOp() {}

function resolveTarget(target) {
  if (target?.nodeType === 1) return target;
  if (typeof document === 'undefined') return null;
  return document.getElementById(target || 'paper-background');
}

function applyCssFallback(element) {
  element.dataset.paperFallback = 'true';
  element.style.backgroundColor = FALLBACK_BACKGROUND_COLOR;
  element.style.backgroundImage = FALLBACK_BACKGROUND_IMAGE;
  element.style.backgroundSize = 'auto, 5px 5px, 10px 10px';
}

function hasWebGL2(documentRef) {
  try {
    const probe = documentRef.createElement('canvas');
    const context = probe.getContext('webgl2', { alpha: false, antialias: false });
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

/**
 * Mount the static Paper Design paper texture into #paper-background.
 * Returns a cleanup function for callers that own the page lifecycle.
 */
export function mountPaperBackground(target) {
  const element = resolveTarget(target);
  if (!element) return noOp;

  const previousStyles = {
    backgroundColor: element.style.backgroundColor,
    backgroundImage: element.style.backgroundImage,
    backgroundSize: element.style.backgroundSize,
  };
  let disposed = false;
  let mount;
  let noiseTexture;

  const clearFallback = () => {
    element.style.backgroundColor = previousStyles.backgroundColor;
    element.style.backgroundImage = previousStyles.backgroundImage;
    element.style.backgroundSize = previousStyles.backgroundSize;
    delete element.dataset.paperFallback;
  };

  const fallback = () => {
    if (!disposed) applyCssFallback(element);
  };

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('pagehide', cleanup);
    noiseTexture?.removeEventListener('load', mountShader);
    noiseTexture?.removeEventListener('error', fallback);
    mount?.dispose();
    mount = undefined;
    element.removeAttribute('data-paper-shader');
    clearFallback();
  };

  const mountShader = () => {
    if (disposed || !noiseTexture?.complete || !noiseTexture.naturalWidth) return;

    const existingCanvases = new Set(element.querySelectorAll('canvas'));
    try {
      mount = new ShaderMount(
        element,
        paperTextureFragmentShader,
        { ...PAPER_UNIFORMS, u_noiseTexture: noiseTexture },
        { alpha: false, antialias: false, premultipliedAlpha: false },
        0,
        0,
        1,
        MAX_PIXEL_COUNT,
      );
      clearFallback();
    } catch {
      for (const canvas of element.querySelectorAll('canvas')) {
        if (!existingCanvases.has(canvas)) canvas.remove();
      }
      fallback();
    }
  };

  applyCssFallback(element);
  window.addEventListener('pagehide', cleanup, { once: true });

  if (!hasWebGL2(element.ownerDocument)) return cleanup;

  noiseTexture = getShaderNoiseTexture();
  if (!noiseTexture) return cleanup;
  noiseTexture.addEventListener('load', mountShader, { once: true });
  noiseTexture.addEventListener('error', fallback, { once: true });
  if (noiseTexture.complete) mountShader();

  return cleanup;
}

export default mountPaperBackground;

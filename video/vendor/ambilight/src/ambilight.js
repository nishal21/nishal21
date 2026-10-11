/*! Ambient light renderer for nishal21's video page, built on youtube-ambilight's own code.
 * recreateProjectors(), resizeCanvasses(), the projector sizing and filter part of updateSizes(), the debanding
 * setup and the video frame callback scheduling are copied from youtube-ambilight src/scripts/libs/ambientlight.js
 * (commit 18d17188e5562e5ee913f005192d30c9a60be078) and trimmed to what this page needs: no YouTube page DOM,
 * no theater/fullscreen views, no HDR, VR, frame blending or video overlay, no stats UI.
 * MIT License, Copyright (c) 2017 Wessel Kroos. The full license is in ../LICENSE (vendor/ambilight/LICENSE). */
import ProjectorWebGL from './projector-webgl';
import Projector2d from './projector-2d';
import BarDetection from './bar-detection';
import SettingsConfig from './settings-config';
import { ctxOptions, SafeOffscreenCanvas, setErrorHandler, setStyleProperty } from './generic';

setErrorHandler((ex) => console.warn('ambient light:', ex));

// the extension's default value for every setting
export const extensionDefaults = Object.fromEntries(
  SettingsConfig.filter((s) => s.name && 'default' in s && s.type !== 'section').map((s) => [s.name, s.default])
);

const noop = () => {};
const stats = { updateBarDetectionImage: noop, updateBarDetectionResult: noop, addBarDetectionDuration: noop, updateBarDetectionInfo: noop };

export class Ambilight {
  innerStrength = 2;
  videoScale = 100;
  barsClip = [0, 0];
  clippedVideoScale = [1, 1];
  atTop = true;
  isPageHidden = false;
  buffersCleared = true;
  sizesChanged = true;
  canvassesInvalidated = true;
  shouldStyleVideoParentElem = true;
  stats = stats;

  // container: the element the light lives in (positioned, behind the page); videoContainerElem: the player box
  constructor({ container, videoContainerElem, videoElem, settings, onWarning }) {
    this.container = container;
    this.videoContainerElem = videoContainerElem;
    this.videoElem = videoElem;
    const self = this;
    this.settings = {
      ...extensionDefaults,
      ...settings,
      setWarning: (text) => onWarning?.(text),
      set(name, value) { this[name] = value; if (name === 'resolution') self.sizesChanged = true; },
    };
  }

  async init() {
    // same element tree as the extension: filter > clip > projectors > projector-list
    this.containerElem = document.createElement('div');
    this.containerElem.classList.add('ambientlight__container');
    this.filterElem = document.createElement('div');
    this.filterElem.classList.add('ambientlight__filter');
    this.clipElem = document.createElement('div');
    this.clipElem.classList.add('ambientlight__clip');
    this.projectorsElem = document.createElement('div');
    this.projectorsElem.classList.add('ambientlight__projectors');
    this.projectorListElem = document.createElement('div');
    this.projectorListElem.classList.add('ambientlight__projector-list');
    this.projectorsElem.append(this.projectorListElem);
    this.clipElem.append(this.projectorsElem);
    this.filterElem.append(this.clipElem);
    this.containerElem.append(this.filterElem);
    this.container.prepend(this.containerElem);

    this.barDetection = new BarDetection(this);
    // initProjectorBuffers(): the extension's 2D buffer (its WebGL buffer is an optional speed-up we leave out)
    const elem = new SafeOffscreenCanvas(1, 1, true);
    this.projectorBuffer = { elem, ctx: elem.getContext('2d', ctxOptions) };

    // initProjector()
    if (this.settings.webGL) {
      try {
        this.projector = await new ProjectorWebGL(this, this.projectorListElem, noop, this.settings);
      } catch (ex) {
        console.warn('ambient light: WebGL failed, using canvas 2D', ex);
        this.projector = undefined;
      }
    }
    if (!this.projector) {
      this.settings.webGL = false;
      this.projector = new Projector2d(this, this.projectorListElem, noop, this.settings);
    }
    this.updateStyles();
    return this;
  }

  // initProjector()'s canvas 2D branch, used when WebGL can't take the picture
  useProjector2d() {
    // (the projectors' own remove() would take the whole list with it, so the list is emptied instead)
    this.projectorListElem.replaceChildren();
    this.settings.webGL = false;
    this.projector = new Projector2d(this, this.projectorListElem, noop, this.settings);
    this.canvassesInvalidated = true;
    this.sizesChanged = true;
  }

  get type() { return this.projector?.type; }

  setSettings(values) {
    Object.assign(this.settings, values);
    this.canvassesInvalidated = true;
    this.sizesChanged = true;
    this.updateStyles();
  }

  // ambientlight.js recreateProjectors()
  recreateProjectors() {
    this.levels = Math.max(2, Math.round(this.settings.spread / this.settings.edge) + this.innerStrength + 1);
    if (this.projector.recreate) {
      this.projector.recreate(this.levels);
    }
  }

  // the part of ambientlight.js updateSizes() that places and sizes the projectors; the video rect is ours
  updateSizes(srcWidth, srcHeight) {
    const box = this.videoContainerElem, host = this.containerElem;
    if (!box.offsetWidth || !box.offsetHeight || !srcWidth || !srcHeight) return false;
    const unscaledWidth = box.offsetWidth, unscaledHeight = box.offsetHeight;
    const hostRect = host.getBoundingClientRect(), rect = box.getBoundingClientRect();
    this.videoOffset = { top: rect.top - hostRect.top, left: rect.left - hostRect.left, width: unscaledWidth, height: unscaledHeight };
    this.projectorsElem.style.left = `${this.videoOffset.left}px`;
    this.projectorsElem.style.top = `${this.videoOffset.top}px`;
    this.projectorsElem.style.width = `${unscaledWidth}px`;
    this.projectorsElem.style.height = `${unscaledHeight}px`;
    this.projectorsElem.style.transform = `scale(${this.clippedVideoScale[0]}, ${this.clippedVideoScale[1]})`;
    if (this.settings.webGL) this.projector.cropped = false;

    const blur = this.settings.blur2;
    const { contrast, brightness, saturation } = this.settings;
    this.filterElem.style.filter = `
      ${!this.settings.webGL && blur != 0 ? `blur(${Math.round(this.videoOffset.height * 0.0025 * this.settings.blur2)}px)` : ''}
      ${contrast != 100 ? `contrast(${contrast}%)` : ''}
      ${brightness != 100 ? `brightness(${brightness}%)` : ''}
      ${saturation != 100 ? `saturate(${saturation}%)` : ''}
    `.trim();

    this.srcVideoOffset = { top: this.videoOffset.top, width: srcWidth, height: srcHeight };

    let pScale;
    if (this.settings.webGL) {
      const relativeBlur = (this.settings.resolution / 100) * this.settings.blur2;
      let pMinSize =
        (this.settings.resolution / 100) *
        (this.settings.detectHorizontalBarSizeEnabled || this.settings.detectVerticalBarSizeEnabled
          ? 256
          : relativeBlur >= 20
          ? 128
          : relativeBlur >= 10
          ? 192
          : 256);
      if (this.settings.spread > 200) pMinSize = pMinSize / 2;

      pScale = Math.min(
        0.5,
        Math.max(pMinSize / this.srcVideoOffset.width, pMinSize / this.srcVideoOffset.height),
        Math.min(1024 / this.srcVideoOffset.width, 1024 / this.srcVideoOffset.height)
      );
    } else {
      // A size of 512 videoWidth/videoHeight is required to prevent pixel flickering because CanvasContext2D uses no mipmaps
      // A CanvasContext2D size of > 256 is required to enable GPU acceleration in Chrome
      const pMinSize = Math.max(257, Math.min(512, this.srcVideoOffset.width, this.srcVideoOffset.height));
      pScale = Math.max(pMinSize / this.srcVideoOffset.width, pMinSize / this.srcVideoOffset.height);
    }
    this.p = { w: Math.ceil(this.srcVideoOffset.width * pScale), h: Math.ceil(this.srcVideoOffset.height * pScale) };
    if (this.canvassesInvalidated) {
      this.recreateProjectors();
      this.canvassesInvalidated = false;
    }
    this.projector.resize(this.p.w, this.p.h);

    // the extension's 2D projector buffer is drawn at the projector size
    if (this.projectorBuffer.elem.width !== this.p.w) this.projectorBuffer.elem.width = this.p.w;
    if (this.projectorBuffer.elem.height !== this.p.h) this.projectorBuffer.elem.height = this.p.h;

    this.resizeCanvasses();
    this.buffersCleared = true;
    this.sizesChanged = false;
    this.srcSize = [srcWidth, srcHeight];
    return true;
  }

  // ambientlight.js resizeCanvasses()
  resizeCanvasses() {
    if (this.canvassesInvalidated) {
      this.recreateProjectors();
      this.canvassesInvalidated = false;
    }

    const projectorSize = {
      w: Math.round(this.p.w * this.clippedVideoScale[0]),
      h: Math.round(this.p.h * this.clippedVideoScale[1]),
    };
    const ratio =
      this.p.w > this.p.h
        ? { x: this.p.w / projectorSize.w, y: (this.p.w / projectorSize.w) * (projectorSize.w / projectorSize.h) }
        : { x: (this.p.h / projectorSize.h) * (projectorSize.h / projectorSize.w), y: this.p.h / projectorSize.h };
    const lastScale = { x: 1, y: 1 };

    //To prevent 0x0 sized canvas elements causing a GPU memory leak
    const minScale = { x: 1 / projectorSize.w, y: 1 / projectorSize.h };

    const scaleStep = this.settings.edge / 100;
    const scales = [];
    for (let i = 0; i < this.levels; i++) {
      const pos = i - this.innerStrength;
      let scaleX = 1;
      let scaleY = 1;

      if (pos > 0) {
        scaleX = 1 + scaleStep * ratio.x * pos;
        scaleY = 1 + scaleStep * ratio.y * pos;
      }

      if (pos < 0) {
        scaleX = 1 - scaleStep * ratio.x * -pos;
        scaleY = 1 - scaleStep * ratio.y * -pos;
        if (scaleX < 0) scaleX = 0;
        if (scaleY < 0) scaleY = 0;
      }
      lastScale.x = scaleX;
      lastScale.y = scaleY;

      scales.push({ x: Math.max(minScale.x, scaleX), y: Math.max(minScale.y, scaleY) });
    }

    this.projector.rescale(scales, lastScale, projectorSize, this.barsClip, this.settings);
    this.scales = scales;
    this.lastScale = lastScale;
  }

  // debanding part of ambientlight.js updateStyles(), with the noise images vendored next to this file
  updateStyles() {
    const baseUrl = new URL('images/', this.settings.assetsUrl || location.href).href;
    const debandingStrength = parseFloat(this.settings.debandingStrength);
    const noiseImageIndex = debandingStrength > 75 ? 3 : debandingStrength > 50 ? 2 : 1;
    const noiseOpacity = debandingStrength / (debandingStrength > 75 ? 100 : debandingStrength > 50 ? 75 : 50);
    setStyleProperty(this.container, '--ytal-debanding-content', debandingStrength ? `''` : '');
    setStyleProperty(this.container, '--ytal-debanding-background', debandingStrength ? `url('${baseUrl}noise-${noiseImageIndex}.png')` : '');
    setStyleProperty(this.container, '--ytal-debanding-opacity', debandingStrength ? noiseOpacity : '');
  }

  // one frame: the extension draws the source into its projector buffer, then the projector draws the buffer.
  // src is the <video> or an image; sx..sh optionally pick a region (a storyboard tile)
  draw(src, sx, sy, sw, sh) {
    const w = sw ?? (src.videoWidth || src.naturalWidth || src.width);
    const h = sh ?? (src.videoHeight || src.naturalHeight || src.height);
    if (!w || !h) return false;
    if (this.sizesChanged || this.canvassesInvalidated || !this.p || this.srcSize?.[0] !== w || this.srcSize?.[1] !== h) {
      if (!this.updateSizes(w, h)) return false;
    }
    const buf = this.projectorBuffer;
    if (sw) buf.ctx.drawImage(src, sx, sy, sw, sh, 0, 0, buf.elem.width, buf.elem.height);
    else buf.ctx.drawImage(src, 0, 0, buf.elem.width, buf.elem.height);
    try {
      this.projector.draw(buf.elem);
    } catch (ex) {
      // WebGL refuses pictures from another site that didn't allow it (a tainted buffer); canvas 2D can still show them
      if (this.settings.webGL && ex?.name === 'SecurityError') {
        this.useProjector2d();
        return this.draw(src, sx, sy, sw, sh);
      }
      throw ex;
    }
    this.buffersCleared = false;
    this.frameCount = (this.frameCount || 0) + 1;
    if (this.settings.detectHorizontalBarSizeEnabled || this.settings.detectVerticalBarSizeEnabled) this.scheduleBarSizeDetection();
    return true;
  }

  // ambientlight.js scheduleBarSizeDetection() / scheduleBarSizeDetectionCallback(), at most twice a second
  scheduleBarSizeDetection() {
    const now = performance.now();
    if (this.barsReadable === false || now - (this.lastBarDetection || 0) < 500) return;
    this.lastBarDetection = now;
    try {
      this.projectorBuffer.ctx.getImageData(0, 0, 1, 1); // checkGetImageDataAllowed()
    } catch {
      this.barsReadable = false;
      return;
    }
    this.barDetection.detect(
      this.projectorBuffer.elem,
      this.settings.detectColoredHorizontalBarSizeEnabled,
      this.settings.detectHorizontalBarSizeOffsetPercentage,
      this.settings.detectHorizontalBarSizeEnabled,
      this.settings.horizontalBarsClipPercentage,
      this.settings.detectVerticalBarSizeEnabled,
      this.settings.verticalBarsClipPercentage,
      this.p ? this.p.h / this.p.w : 1,
      false, // the buffer is reused for the next frame, so it can't be transferred
      this.settings.barSizeDetectionAverageHistorySize || 1,
      this.settings.barSizeDetectionAllowedElementsPercentage || 20,
      this.settings.barSizeDetectionAllowedUnevenBarsPercentage || 20,
      (horizontal, vertical) => {
        let changed = false;
        if (this.settings.detectHorizontalBarSizeEnabled && horizontal !== undefined && this.settings.horizontalBarsClipPercentage !== horizontal) {
          this.settings.horizontalBarsClipPercentage = horizontal;
          changed = true;
        }
        if (this.settings.detectVerticalBarSizeEnabled && vertical !== undefined && this.settings.verticalBarsClipPercentage !== vertical) {
          this.settings.verticalBarsClipPercentage = vertical;
          changed = true;
        }
        if (changed) this.updateBarsClip();
      }
    ).catch(() => { this.barsReadable = false; });
  }
  // from ambientlight.js updateSizes(): the bars are cut off the projected picture
  updateBarsClip() {
    const h = this.settings.detectHorizontalBarSizeEnabled ? (this.settings.horizontalBarsClipPercentage || 0) / 100 : 0;
    const v = this.settings.detectVerticalBarSizeEnabled ? (this.settings.verticalBarsClipPercentage || 0) / 100 : 0;
    this.barsClip = [v, h];
    this.clippedVideoScale = this.barsClip.map((p) => 1 - p * 2);
    this.sizesChanged = true;
  }
  resetBars() {
    this.barDetection?.reset();
    this.settings.horizontalBarsClipPercentage = 0;
    this.settings.verticalBarsClipPercentage = 0;
    this.barsReadable = undefined;
    this.updateBarsClip();
  }

  clear() {
    this.barDetection?.clear();
    this.projector?.clearRect?.();
    this.buffersCleared = true;
  }

  // isPageHidden / atTop hooks the projector reads
  optionalFrame = async () => {};
  setDrawWarning = noop;
}

// the extension's frame scheduling (onVideoFrame): request the next callback before drawing, plus an empty one
// "as soon as possible to prevent skipped video frames on displays with a matching framerate"
export function followVideoFrames(videoElem, onFrame) {
  let id = 0, stopped = false;
  if (!videoElem.requestVideoFrameCallback) return null;
  const step = (now, info) => {
    if (stopped) return;
    videoElem.requestVideoFrameCallback(function prescheduledVFC() {});
    id = videoElem.requestVideoFrameCallback(step);
    onFrame(now, info);
  };
  id = videoElem.requestVideoFrameCallback(step);
  return () => { stopped = true; videoElem.cancelVideoFrameCallback?.(id); };
}
